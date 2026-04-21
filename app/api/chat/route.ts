import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { calculateRequestCost } from "@/lib/agent/capabilities";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { runChatAgent, AgentUpstreamError } from "@/lib/chat/agent-runner";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5;

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

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "Service unavailable",
          message: "AI chat is not configured (missing OPENAI_API_KEY)",
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
    const model = modelOpt?.trim() || DEFAULT_MODEL;

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
        model,
        userId: context.userId,
        requestId: context.requestId,
        maxToolRounds: MAX_TOOL_ROUNDS,
        allowParallelOpenAI: bodyParallelToolCalls !== false,
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
  },
  {
    capabilityId: "chat-risk-analyst",
    getTokenEstimates: estimateChatTokens,
  },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
