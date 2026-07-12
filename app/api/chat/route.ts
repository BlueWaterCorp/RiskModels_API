import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { calculateRequestCost } from "@/lib/agent/capabilities";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import {
  runChatAgent,
  runChatAgentStream,
  summarizeToolCalls,
  AgentUpstreamError,
} from "@/lib/chat/agent-runner";
import {
  encodeSseEvent,
  type ChatQuota,
  type ChatStreamEvent,
} from "@/lib/chat/stream-events";
import { getUserBalance } from "@/lib/agent/billing";
import { resolveAgentBackend, hasChatBackend } from "@/lib/chat/llm-backend";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import type { ToolCallResult } from "@/lib/chat/tool-executor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Backend (model + client) is resolved per-request by resolveAgentBackend():
// Moonshot/Kimi when MOONSHOT_API_KEY is set, else Claude (AGENT_BACKEND=claude)
// or OpenAI. A request-supplied claude-* `model:` always forces Anthropic.
const MAX_TOOL_ROUNDS = 5;

/** A rendered artifact surfaced to the chat UI for inline display. */
export interface ChatArtifact {
  tool_call_id: string;
  slug: string;
  version: string;
  subject_id: string;
  format: string;
  resolved_as_of: string | null;
  receipt_id: string | null;
  gcs_path: string | null;
  /** Payload: base64 string for png/svg, JSON object for json. */
  artifact: unknown;
}

/**
 * Pull successfully-rendered artifacts out of the render_artifact tool results
 * so the chat UI can show them inline. Without this the route returns only the
 * LLM's text and the rendered artifact payload is discarded.
 */
function extractChatArtifacts(toolCallResults: ToolCallResult[]): ChatArtifact[] {
  const out: ChatArtifact[] = [];
  for (const r of toolCallResults) {
    if (r.name !== "render_artifact" || r.error) continue;
    const res = r.result;
    if (!res || typeof res !== "object") continue;
    const o = res as Record<string, unknown>;
    // execRenderArtifact returns {error: ...} on a failed render — skip those.
    if (o.error !== undefined || o.artifact === undefined) continue;
    out.push({
      tool_call_id: r.tool_call_id,
      slug: String(o.slug ?? ""),
      version: String(o.version ?? ""),
      subject_id: String(o.subject_id ?? ""),
      format: String(o.format ?? "json"),
      resolved_as_of: o.resolved_as_of != null ? String(o.resolved_as_of) : null,
      receipt_id: o.receipt_id != null ? String(o.receipt_id) : null,
      gcs_path: o.gcs_path != null ? String(o.gcs_path) : null,
      artifact: o.artifact,
    });
  }
  return out;
}

function appendCostLineIfMissing(content: string, toolTotalUsd: number, toolCallCount: number): string {
  if (toolCallCount === 0) return content;
  if (/\bAPI tool costs\b|\bTool costs\b|\*\*Tool/i.test(content)) return content;
  return `${content.trimEnd()}\n\n---\n**API tool costs:** $${toolTotalUsd.toFixed(4)} (${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"})`;
}

async function estimateChatTokens(req: NextRequest) {
  const clone = req.clone();
  let body: unknown;
  try {
    body = await clone.json();
  } catch {
    return { inputTokens: 200, outputTokens: 800 };
  }
  const parsed = ChatPostSchema.safeParse(body);
  if (!parsed.success) {
    return { inputTokens: 200, outputTokens: 800 };
  }
  let chars = 0;
  for (const m of parsed.data.messages) {
    chars += m.content.length;
  }
  const inputTokens = Math.min(
    100_000,
    Math.max(120, Math.ceil(chars / 3) + 3000),
  );
  const outputTokens = 2000;
  return { inputTokens, outputTokens };
}

const chatHandler = async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    // At least one backend must be configured. The runner picks per-request
    // based on the resolved model (claude-* → Anthropic, else Moonshot), so we
    // only hard-fail here if neither key is present.
    if (!hasChatBackend()) {
      return NextResponse.json(
        {
          error: "Service unavailable",
          message:
            "AI chat is not configured (need MOONSHOT_API_KEY or ANTHROPIC_API_KEY)",
        },
        { status: 503, headers: getCorsHeaders(origin) },
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = ChatPostSchema.safeParse(raw);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]?.message ?? "Validation failed",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const {
      messages: userMessages,
      model: modelOpt,
      parallel_tool_calls: bodyParallelToolCalls,
      execute_tools_sequentially: bodyExecSequential,
    } = validation.data;
    const backend = resolveAgentBackend(modelOpt);

    const llmEst = calculateRequestCost(
      "chat-risk-analyst",
      Math.ceil(
        userMessages.reduce((a, m) => a + m.content.length, 0) / 3 + 3000,
      ),
      2000,
    );
    const softToolAssumptionUsd = calculateRequestCost("metrics-snapshot") * 2;
    console.info(
      "[chat] soft_preflight_estimate_usd",
      JSON.stringify({
        llm_est_usd: llmEst,
        assumed_two_tools_usd: softToolAssumptionUsd,
      }),
    );

    const fetchStart = performance.now();

    let runResult;
    try {
      runResult = await runChatAgent({
        userMessages,
        model: backend.model,
        openai: backend.openai,
        userId: context.userId,
        requestId: context.requestId,
        maxToolRounds: MAX_TOOL_ROUNDS,
        allowParallelOpenAI: backend.allowParallel && bodyParallelToolCalls !== false,
        omitParallelToolCalls: backend.omitParallelToolCalls,
        execParallel: !bodyExecSequential,
      });
    } catch (e) {
      if (e instanceof AgentUpstreamError) {
        console.error("[chat]", e);
        return NextResponse.json(
          { error: "Upstream AI error", message: e.message },
          { status: 502, headers: getCorsHeaders(origin) },
        );
      }
      throw e;
    }

    const { finalContent: rawContent, model: finalModel, usage: totalUsage, toolCallResults } = runResult;
    const toolCostTotal = toolCallResults.reduce((s, r) => s + r.cost_usd, 0);
    const totalCost = context.costUsd + toolCostTotal;
    const finalContent = appendCostLineIfMissing(rawContent, toolCostTotal, toolCallResults.length);
    const chatArtifacts = extractChatArtifacts(toolCallResults);

    const latency = Math.round(performance.now() - fetchStart);
    const metadata = await getRiskMetadata();

    const response = NextResponse.json(
      {
        message: {
          role: "assistant" as const,
          content: finalContent,
        },
        model: finalModel,
        usage: {
          prompt_tokens: totalUsage.prompt_tokens,
          completion_tokens: totalUsage.completion_tokens,
          total_tokens: totalUsage.total_tokens,
        },
        tool_calls_summary:
          toolCallResults.length > 0
            ? toolCallResults.map((r) => ({
                tool: r.name,
                capability: r.capability_id,
                cost_usd: r.cost_usd,
                latency_ms: r.latency_ms,
                error: r.error ?? null,
              }))
            : null,
        artifacts: chatArtifacts.length > 0 ? chatArtifacts : null,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: totalCost,
          llm_cost_usd: context.costUsd,
          tool_cost_usd: toolCostTotal,
          tool_calls: toolCallResults.length,
          request_id: context.requestId,
          latency_ms: latency,
        },
      },
      {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": String(latency),
        },
      },
    );
    addMetadataHeaders(response, metadata);
    return response;
};

/** $20 = 1M tokens (mirrors billing-middleware's token-bucket headers). */
const TOKEN_PRICE_USD = 0.00002;

/**
 * SSE handler for `Accept: text/event-stream` (G.23 P1).
 *
 * Frames = the ChatStreamEvent vocabulary (lib/chat/stream-events.ts). The
 * engine's `final` is intercepted and re-emitted enriched: same cost-line
 * append as the blocking path, plus `quota`. Billing settles at `final` via
 * `context.settleBilling` (deferBillingToHandler) — deduct only on success,
 * after the run completes, identical to the blocking path's semantics. A
 * dropped connection does not cancel the run: it proceeds to `final` and
 * still bills (enqueue failures are swallowed). Turn persistence is a
 * consumer concern in P1, so `persisted_id` is always null here.
 */
const chatStreamHandler = async (
  request: NextRequest,
  context: BillingContext,
) => {
  const origin = request.headers.get("origin");

  if (!hasChatBackend()) {
    return NextResponse.json(
      {
        error: "Service unavailable",
        message:
          "AI chat is not configured (need MOONSHOT_API_KEY or ANTHROPIC_API_KEY)",
      },
      { status: 503, headers: getCorsHeaders(origin) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", message: "Expected JSON body" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const validation = ChatPostSchema.safeParse(raw);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        message: validation.error.issues[0]?.message ?? "Validation failed",
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const {
    messages: userMessages,
    model: modelOpt,
    parallel_tool_calls: bodyParallelToolCalls,
    execute_tools_sequentially: bodyExecSequential,
  } = validation.data;
  const backend = resolveAgentBackend(modelOpt);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        } catch {
          // Client gone — keep running so billing still settles at final.
        }
      };
      let engineErrorSent = false;
      try {
        const result = await runChatAgentStream(
          {
            userMessages,
            model: backend.model,
            openai: backend.openai,
            userId: context.userId,
            requestId: context.requestId,
            maxToolRounds: MAX_TOOL_ROUNDS,
            allowParallelOpenAI:
              backend.allowParallel && bodyParallelToolCalls !== false,
            omitParallelToolCalls: backend.omitParallelToolCalls,
            execParallel: !bodyExecSequential,
          },
          (event) => {
            if (event.type === "final") return; // re-emitted enriched below
            if (event.type === "error") engineErrorSent = true;
            send(event);
          },
        );

        const toolCostTotal = result.toolCallResults.reduce(
          (s, r) => s + r.cost_usd,
          0,
        );
        const finalContent = appendCostLineIfMissing(
          result.finalContent,
          toolCostTotal,
          result.toolCallResults.length,
        );

        await context.settleBilling?.(true);

        let quota: ChatQuota | null = null;
        try {
          const balance = await getUserBalance(context.userId);
          quota = {
            tokens_consumed: Math.ceil(
              (context.costUsd + toolCostTotal) / TOKEN_PRICE_USD,
            ),
            tokens_remaining: Math.floor(balance / TOKEN_PRICE_USD),
          };
        } catch {
          quota = null;
        }

        send({
          type: "final",
          content: finalContent,
          tool_calls_summary: summarizeToolCalls(result.toolCallResults),
          usage: result.usage,
          quota,
          persisted_id: null,
        });
      } catch (e) {
        await context.settleBilling?.(false).catch(() => {});
        if (!engineErrorSent) {
          send({
            type: "error",
            status: e instanceof AgentUpstreamError ? 502 : 500,
            message: e instanceof Error ? e.message : "Chat agent failed",
          });
        }
        console.error("[chat:stream]", e);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed/errored
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};

const postBlocking = withBilling(chatHandler, {
  capabilityId: "chat-risk-analyst",
  getTokenEstimates: estimateChatTokens,
});

const postStreaming = withBilling(chatStreamHandler, {
  capabilityId: "chat-risk-analyst",
  getTokenEstimates: estimateChatTokens,
  deferBillingToHandler: true,
});

/**
 * Content negotiation: `Accept: text/event-stream` opts into SSE streaming;
 * every other request takes the existing blocking JSON path unchanged
 * (OpenBB adapter, .net portal, eval harness stay byte-identical).
 */
export async function POST(request: NextRequest) {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (accept.includes("text/event-stream")) {
    return postStreaming(request);
  }
  return postBlocking(request);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
