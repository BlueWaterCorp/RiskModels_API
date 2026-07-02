/**
 * POST /openbb/query — OpenBB Workspace AI agent endpoint (SSE).
 *
 * Implements OpenBB's custom-agent protocol: takes a `QueryRequest`
 * ({ messages: [{ role: "human"|"ai"|"tool", content }], ... }) and streams the
 * answer back as Server-Sent Events (`event: copilotMessageChunk` /
 * `data: {"delta": ...}`).
 *
 * Thin adapter: it maps OpenBB's messages to our chat format and proxies to the
 * existing tool-calling analyst (`POST /api/chat`, Claude + RiskModels tools),
 * forwarding the OpenBB user's `X-API-KEY` as a Bearer token so auth, billing,
 * entitlements, and the institutional analyst doctrine are all reused unchanged.
 */
import { NextRequest } from "next/server";
import { openbbCors } from "../_lib/cors";
import { bearerFromRequest, upstreamBase } from "../_lib/upstream";

export const dynamic = "force-dynamic";
// Claude + a few tool rounds can run 10–40s; keep the function alive.
export const maxDuration = 120;

// Friendly labels for the tools the analyst actually called (from
// tool_calls_summary) — surfaced to the user as a "Consulted:" status.
const TOOL_LABELS: Record<string, string> = {
  search_tickers: "ticker search",
  get_risk_metrics: "risk metrics",
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

/** Split into sentence/line-ish chunks so the answer renders progressively. */
function chunkText(text: string): string[] {
  const parts = text.match(/[^\n]*\n|[^.!?]*[.!?]+\s*|[^.!?]+$/g);
  return parts && parts.length ? parts.filter((p) => p.length > 0) : [text];
}

export async function POST(req: NextRequest) {
  const cors = openbbCors(req);
  const key = bearerFromRequest(req);

  let body: { messages?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty / invalid body → handled below */
  }
  const messages = mapMessages(body?.messages);

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

      // Flush an early status so OpenBB starts the stream, then heartbeat while
      // the (blocking) tool-calling agent runs so the SSE doesn't idle-timeout.
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

      try {
        const res = await fetch(
          `${upstreamBase()}${isDemo ? "/landing/chat" : "/chat"}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(isDemo ? {} : { Authorization: `Bearer ${key}` }),
            },
            // No model override — /api/chat and /api/landing/chat resolve the
            // backend themselves (Moonshot/Kimi when configured).
            body: JSON.stringify({ messages }),
          },
        );
        clearInterval(heartbeat);

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
          controller.close();
          return;
        }

        // Surface the real tools the analyst consulted (honest, from the run).
        const tools = json?.tool_calls_summary;
        if (Array.isArray(tools) && tools.length) {
          const labels = [
            ...new Set(
              tools
                .map((t) => (t?.tool ? TOOL_LABELS[t.tool] ?? t.tool : null))
                .filter((x): x is string => !!x),
            ),
          ];
          if (labels.length) {
            send("copilotStatusUpdate", {
              eventType: "INFO",
              message: `Consulted: ${labels.join(", ")}`,
              group: "reasoning",
              hidden: false,
            });
          }
        }

        const content = json?.message?.content;
        if (typeof content === "string" && content.trim()) {
          for (const c of chunkText(content)) say(c);
          if (isDemo) {
            say(
              "\n\n— *Free demo · Magnificent 7 only. Get a key at riskmodels.app for the full US universe + portfolio hedging.*",
            );
          }
        } else {
          say(
            isDemo
              ? "This free demo covers the Magnificent 7 — AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA. For any US ticker plus portfolio hedging, get a key at riskmodels.app."
              : "I couldn't find an answer for that. Try naming a specific US ticker.",
          );
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
