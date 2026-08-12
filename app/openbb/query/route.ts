/**
 * POST /openbb/query — OpenBB Workspace AI agent endpoint (SSE).
 *
 * Implements OpenBB's custom-agent protocol (field/event names verified
 * against the `openbb-ai` Python SDK's `models.py` / `helpers.py` — used here
 * as a protocol spec, not a dependency, since this adapter is TypeScript):
 * takes a `QueryRequest` ({ messages, context, widgets, ... }) and streams the
 * answer back as Server-Sent Events (`copilotMessageChunk`,
 * `copilotStatusUpdate`, `copilotCitationCollection`).
 *
 * Thin adapter: it maps OpenBB's messages to our chat format and proxies to the
 * existing tool-calling analyst (`POST /api/chat`, Claude + RiskModels tools),
 * forwarding the OpenBB user's `X-API-KEY` as a Bearer token so auth, billing,
 * entitlements, and the institutional analyst doctrine are all reused unchanged.
 *
 * Keyed requests stream real tokens (G.23 P1): the adapter calls `/api/chat`
 * with `Accept: text/event-stream` and translates the engine's event
 * vocabulary (`lib/chat/stream-events.ts`) live — `status` / `tool` →
 * `copilotStatusUpdate` ("Consulted: <label>"), `delta` →
 * `copilotMessageChunk` (deLatex applied per-delta via a stateful buffer),
 * `final` → `copilotCitationCollection` + close. Two paths keep the previous
 * blocking + word-paced reveal: the keyless demo (`/api/landing/chat` has no
 * SSE mode in P1) and a non-SSE upstream response (older deploy). Statuses and
 * citations are built only from data that's actually true of the run (tools
 * actually called, dashboard context actually supplied) — no invented sources
 * or timings.
 */
import { NextRequest } from "next/server";
import { translateChatStream, parseSseEvents } from "../_lib/chat-stream";
import { openbbCors } from "../_lib/cors";
import { deLatex } from "../_lib/delatex";
import { bearerFromRequest, upstreamBase } from "../_lib/upstream";

export const dynamic = "force-dynamic";
// Claude + a few tool rounds can run 10–40s; keep the function alive.
export const maxDuration = 120;

// Minimal shapes for the QueryRequest fields we read — see openbb-ai's
// models.py for the full spec. Only the fields this adapter uses are typed.
type WidgetParam = { name?: string; value?: unknown };
type InboundWidget = {
  uuid?: string;
  origin?: string;
  widget_id?: string;
  name?: string;
  params?: WidgetParam[];
};
type WidgetCollection = {
  primary?: InboundWidget[];
  secondary?: InboundWidget[];
  extra?: InboundWidget[];
};
type RawContext = {
  uuid?: string;
  name?: string;
  description?: string;
  data?: unknown;
};

// Friendly labels for the tools the analyst actually called (from
// tool_calls_summary) — surfaced to the user as a "Consulted:" status.
const TOOL_LABELS: Record<string, string> = {
  search_tickers: "ticker search",
  get_risk_metrics: "risk metrics",
  get_stock_commentary_bundle: "stock commentary",
  compare_tickers: "ticker compare",
  get_correlation: "correlation",
  get_rankings: "rankings",
  get_l3_decomposition: "L3 decomposition",
  get_residual_signal: "residual signal",
  hedge_basket: "hedge basket",
  get_fund_holdings: "fund holdings",
  get_filer_holdings: "13F filer holdings",
  factor_correlation: "factor correlation",
  macro_factors: "macro factors",
  render_artifact: "chart render",
};

type InboundMessage = { role?: string; content?: unknown };
type ChatMessage = { role: "user" | "assistant"; content: string };

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** OpenBB roles: human→user, ai→assistant. Tool / function-call messages (non-string content) are skipped. */
function mapMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw as InboundMessage[]) {
    const content = m?.content;
    if (typeof content !== "string" || !content.trim()) continue;
    if (m.role === "human") out.push({ role: "user", content });
    else if (m.role === "ai") out.push({ role: "assistant", content });
  }
  return out;
}

/** Split into word-ish chunks (whitespace-preserving) for a paced reveal. */
function wordChunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Render the user's pinned dashboard context (OpenBB `context`, distinct from
 * the `widgets` catalog) as a short reference block, prepended to the user's
 * question — real data the user actually has on screen, truncated so it can't
 * blow out the prompt.
 */
function summarizeContext(context: RawContext[] | undefined): string {
  if (!Array.isArray(context) || !context.length) return "";
  const lines = context.slice(0, 5).map((c) => {
    const raw = typeof c.data === "string" ? c.data : JSON.stringify(c.data ?? null);
    const data = raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
    const label = c.description ? `${c.name ?? "widget"} (${c.description})` : c.name ?? "widget";
    return `- ${label}: ${data}`;
  });
  return `Dashboard context currently pinned by the user (reference only, not a question):\n${lines.join("\n")}`;
}

/** Find the widget catalog entry a pinned context item came from, by uuid or name. */
function findWidget(ctx: RawContext, widgets: WidgetCollection | undefined): InboundWidget | null {
  if (!widgets) return null;
  const all = [...(widgets.primary ?? []), ...(widgets.secondary ?? []), ...(widgets.extra ?? [])];
  return (
    all.find((w) => (ctx.uuid && w.uuid === ctx.uuid) || (ctx.name && w.name === ctx.name)) ?? null
  );
}

/** Build honest `Citation`s — only for context the request actually supplied and matched to a real widget. */
function buildCitations(
  context: RawContext[] | undefined,
  widgets: WidgetCollection | undefined,
): Array<Record<string, unknown>> {
  if (!Array.isArray(context) || !context.length) return [];
  const citations: Array<Record<string, unknown>> = [];
  for (const ctx of context.slice(0, 5)) {
    const widget = findWidget(ctx, widgets);
    if (!widget) continue;
    citations.push({
      id: crypto.randomUUID(),
      source_info: {
        type: "widget",
        origin: widget.origin ?? "unknown",
        widget_id: widget.widget_id ?? widget.uuid ?? "unknown",
        metadata: {
          input_args: Object.fromEntries(
            (widget.params ?? []).map((p) => [p.name ?? "", p.value ?? null]),
          ),
        },
      },
      details: ctx.description ? [ctx.description] : undefined,
    });
  }
  return citations;
}

export async function POST(req: NextRequest) {
  const cors = openbbCors(req);
  const key = bearerFromRequest(req);

  let body: { messages?: unknown; context?: RawContext[]; widgets?: WidgetCollection } = {};
  try {
    body = await req.json();
  } catch {
    /* empty / invalid body → handled below */
  }
  const messages = mapMessages(body?.messages);
  const contextBlock = summarizeContext(body?.context);
  if (contextBlock && messages.length) {
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx >= 0) {
      messages[lastUserIdx] = {
        ...messages[lastUserIdx],
        content: `${contextBlock}\n\n${messages[lastUserIdx].content}`,
      };
    }
  }
  const citations = buildCitations(body?.context, body?.widgets);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          /* stream already closed */
        }
      };
      const say = (delta: string) => send("copilotMessageChunk", { delta });

      if (!messages.length) {
        say(
          'Ask me about a name\'s risk — e.g. "What\'s driving AAPL\'s risk and how would I hedge it?"',
        );
        controller.close();
        return;
      }
      // OpenBB never forwards the user's key to the copilot agent (its
      // QueryRequest.api_keys is OpenAI-only), so the agent runs as a free MAG7
      // demo (keyless, rate-limited) via /api/landing/chat. A key — only present
      // for direct API callers — unlocks the full universe via /api/chat.
      const isDemo = !key;

      // Flush an early status so OpenBB starts the stream, then heartbeat
      // until the upstream produces its first event (keyed SSE path) or the
      // blocking call returns (demo / fallback) so the SSE doesn't idle out.
      send("copilotStatusUpdate", {
        eventType: "INFO",
        message: "Analyzing with RiskModels…",
        group: "reasoning",
        hidden: false,
      });
      const heartbeat = setInterval(() => {
        send("copilotStatusUpdate", {
          eventType: "INFO",
          message: "Working…",
          group: "reasoning",
          hidden: true,
        });
      }, 5000);

      // Blocking JSON response → paced word-by-word reveal. Used by the demo
      // path (no SSE mode on /api/landing/chat in P1) and as the fallback when
      // a keyed upstream doesn't speak SSE (older deploy).
      const handleBlockingResponse = async (res: Response) => {
        const json = (await res.json().catch(() => ({}))) as {
          message?: { content?: string };
          error?: string;
          tool_calls_summary?: Array<{ tool?: string }> | null;
        };
        if (!res.ok) {
          const err =
            (json as { message?: string })?.message ||
            json?.error ||
            "Sorry — the analyst is unavailable right now. Please try again.";
          say(typeof err === "string" ? err : "Sorry — the analyst is unavailable.");
          return;
        }

        // Surface the real tools the analyst consulted (honest, from the run) —
        // one reasoning_step-style status line per tool, not one combined line.
        const tools = json?.tool_calls_summary;
        if (Array.isArray(tools) && tools.length) {
          const labels = [
            ...new Set(
              tools
                .map((t) => (t?.tool ? TOOL_LABELS[t.tool] ?? t.tool : null))
                .filter((x): x is string => !!x),
            ),
          ];
          for (const label of labels) {
            send("copilotStatusUpdate", {
              eventType: "INFO",
              message: `Consulted: ${label}`,
              group: "reasoning",
              hidden: false,
            });
            await sleep(120);
          }
        }

        // Cite the dashboard widgets that actually fed this answer (if any).
        if (citations.length) {
          send("copilotCitationCollection", { citations });
        }

        const rawContent = json?.message?.content;
        // OpenBB's chat panel doesn't render LaTeX — convert the math the
        // LLM tends to emit ($$...$$, $R_f$, \beta) to plain text/unicode.
        const content =
          typeof rawContent === "string" ? deLatex(rawContent) : rawContent;
        if (typeof content === "string" && content.trim()) {
          // The upstream call was blocking — pace the complete answer out
          // word-by-word so it reads as a live reveal rather than one dump.
          for (const chunk of wordChunks(content)) {
            say(chunk);
            await sleep(12);
          }
          if (isDemo) {
            say(
              "\n\n— *Free demo · fundamentals & cost of capital for any covered US ticker; risk tools for the Magnificent 7. Get a key at riskmodels.app for the full universe + portfolio hedging.*",
            );
          }
        } else {
          say(
            isDemo
              ? "This free demo answers fundamentals and cost-of-capital questions for any covered US ticker, and risk questions for the Magnificent 7 (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). For the full universe plus portfolio hedging, get a key at riskmodels.app."
              : "I couldn't find an answer for that. Try naming a specific US ticker.",
          );
        }
      };

      try {
        if (isDemo) {
          const res = await fetch(`${upstreamBase()}/landing/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // No model override — /api/landing/chat resolves the backend
            // itself (Moonshot/Kimi when configured).
            body: JSON.stringify({ messages }),
          });
          clearInterval(heartbeat);
          await handleBlockingResponse(res);
        } else {
          const res = await fetch(`${upstreamBase()}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Opt into the engine's SSE mode (G.23 P1) — real token deltas.
              Accept: "text/event-stream",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({ messages }),
          });
          const contentType = res.headers.get("content-type") ?? "";
          if (res.ok && res.body && contentType.includes("text/event-stream")) {
            // Keep the heartbeat until the first upstream event arrives, then
            // let real status/delta frames carry the stream.
            const result = await translateChatStream({
              events: parseSseEvents(res.body),
              send,
              toolLabels: TOOL_LABELS,
              onEvent: () => clearInterval(heartbeat),
            });
            clearInterval(heartbeat);
            if (result.errored) {
              say(
                result.errorMessage ||
                  "Sorry — the analyst is unavailable right now. Please try again.",
              );
            } else {
              // Cite the dashboard widgets that actually fed this answer.
              if (result.sawFinal && citations.length) {
                send("copilotCitationCollection", { citations });
              }
              if (!result.streamedText) {
                say("I couldn't find an answer for that. Try naming a specific US ticker.");
              }
            }
          } else {
            // Upstream doesn't speak SSE (older deploy) or returned an error —
            // fall back to today's blocking + pacing behavior.
            clearInterval(heartbeat);
            await handleBlockingResponse(res);
          }
        }
      } catch {
        clearInterval(heartbeat);
        say("Sorry — the analyst hit an error. Please try again.");
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: openbbCors(req) });
}
