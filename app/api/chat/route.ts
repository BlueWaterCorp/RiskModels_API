import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are the RiskModels AI Risk Analyst. You help users interpret US equity factor risk, hedge ratios (dollars of ETF per $1 of stock), and explained risk (variance fractions summing to ~1 at L3). Be concise and precise. If you lack live data, say so and suggest which RiskModels API endpoints would supply it (e.g. GET /metrics/{ticker}, POST /batch/analyze). Do not invent tickers or figures.`;

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
  const inputTokens = Math.min(100_000, Math.max(120, Math.ceil(chars / 3) + 250));
  const outputTokens = 1500;
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

    const { messages, model: modelOpt } = validation.data;
    const model = modelOpt?.trim() || DEFAULT_MODEL;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fetchStart = performance.now();

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OpenAI request failed";
      console.error("[chat]", e);
      return NextResponse.json(
        { error: "Upstream AI error", message: msg },
        { status: 502, headers: getCorsHeaders(origin) },
      );
    }

    const choice = completion.choices[0];
    const content = choice?.message?.content ?? "";
    const usage = completion.usage;
    const latency = Math.round(performance.now() - fetchStart);
    const metadata = await getRiskMetadata();

    const response = NextResponse.json(
      {
        message: {
          role: "assistant" as const,
          content,
        },
        model: completion.model,
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            }
          : null,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
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
