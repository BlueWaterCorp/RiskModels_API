import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { calculateRequestCost } from "@/lib/agent/capabilities";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { executeToolCalls, type ToolCallResult } from "@/lib/chat/tool-executor";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5;

/** gpt-4o-mini supports parallel_tool_calls; some reasoning models may 400 if forced. */
function modelSupportsParallelToolCalls(model: string): boolean {
  const m = model.toLowerCase();
  if (m.startsWith("o1") || m.startsWith("o3")) return false;
  return true;
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

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fetchStart = performance.now();

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt() },
      ...userMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const toolCallResults: ToolCallResult[] = [];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finalContent = "";
    let finalModel = model;

    const allowParallelOpenAI =
      modelSupportsParallelToolCalls(model) && bodyParallelToolCalls !== false;
    const execParallel = !bodyExecSequential;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: "auto",
          ...(allowParallelOpenAI
            ? { parallel_tool_calls: true }
            : { parallel_tool_calls: false }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "OpenAI request failed";
        console.error("[chat]", e);
        return NextResponse.json(
          { error: "Upstream AI error", message: msg },
          { status: 502, headers: getCorsHeaders(origin) },
        );
      }

      if (completion.usage) {
        totalUsage.prompt_tokens += completion.usage.prompt_tokens;
        totalUsage.completion_tokens += completion.usage.completion_tokens;
        totalUsage.total_tokens += completion.usage.total_tokens;
      }
      finalModel = completion.model;

      const choice = completion.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls?.length) {
        finalContent = assistantMessage.content ?? "";
        break;
      }

      const results = await executeToolCalls(toolCalls, {
        parallel: execParallel,
        userId: context.userId,
        requestId: context.requestId,
      });

      for (const r of results) {
        toolCallResults.push(r);
      }

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const r = results[i];
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(r?.result ?? { error: "No result" }),
        });
      }
    }

    const toolCostTotal = toolCallResults.reduce((s, r) => s + r.cost_usd, 0);
    const totalCost = context.costUsd + toolCostTotal;
    finalContent = appendCostLineIfMissing(finalContent, toolCostTotal, toolCallResults.length);

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
