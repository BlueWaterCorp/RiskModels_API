import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { runChatAgent, AgentUpstreamError } from "@/lib/chat/agent-runner";

/**
 * POST /api/landing/chat — unauthenticated MAG7-only preview of the
 * agentic risk analyst. Wraps the same runChatAgent() loop as
 * POST /api/chat but:
 *
 *   - Skips per-tool billing (skipBilling: true, no deductBalance).
 *   - Restricts the tool registry to a tight subset (search_tickers,
 *     get_risk_metrics, get_correlation, get_rankings).
 *   - preFlightGuard rejects any tool arg that references a non-MAG7
 *     ticker.
 *   - Caps tool rounds at 2 and max_tokens at ~700 to bound LLM spend.
 *   - Per-IP throttle: MAX_MSGS_PER_HOUR per IP using an in-memory Map
 *     (good enough for MVP on a single Vercel instance; swap to Redis
 *     if the demo is opened more than that).
 *
 * For anything beyond MAG7 or the allowlisted tool set, clients must
 * use the real, keyed POST /api/chat.
 */

export const dynamic = "force-dynamic";

const MAG7_ALLOWLIST = new Set([
  "AAPL",
  "MSFT",
  "GOOGL",
  "GOOG",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
]);

const ALLOWED_TOOLS = [
  "search_tickers",
  "get_risk_metrics",
  "get_correlation",
  "get_rankings",
] as const;

const LANDING_MODEL = "gpt-4o-mini";
const LANDING_MAX_ROUNDS = 2;
const LANDING_MAX_TOKENS = 700;
const MAX_MSGS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

type RateBucket = { count: number; resetAt: number };
const rateBuckets: Map<string, RateBucket> = (globalThis as any).__rmLandingChatBuckets ?? new Map();
(globalThis as any).__rmLandingChatBuckets = rateBuckets;

function ipFromRequest(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function checkRateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateBuckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + WINDOW_MS };
    rateBuckets.set(ip, bucket);
    return { ok: true, remaining: MAX_MSGS_PER_HOUR - 1, resetAt: bucket.resetAt };
  }
  if (existing.count >= MAX_MSGS_PER_HOUR) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { ok: true, remaining: MAX_MSGS_PER_HOUR - existing.count, resetAt: existing.resetAt };
}

function extractTickersFromArgs(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const a = args as Record<string, unknown>;
  const tickers: string[] = [];

  if (typeof a.ticker === "string") tickers.push(a.ticker);
  if (Array.isArray(a.tickers)) {
    for (const t of a.tickers) if (typeof t === "string") tickers.push(t);
  }
  if (Array.isArray(a.positions)) {
    for (const p of a.positions) {
      if (p && typeof p === "object" && typeof (p as any).ticker === "string") {
        tickers.push((p as any).ticker);
      }
    }
  }
  // search_tickers is a free lookup; no gating needed.
  if (toolName === "search_tickers") return [];
  return tickers.map((t) => t.trim().toUpperCase()).filter(Boolean);
}

function mag7Guard(toolName: string, args: unknown): string | null {
  const tickers = extractTickersFromArgs(toolName, args);
  if (tickers.length === 0) return null;
  const bad = tickers.filter((t) => !MAG7_ALLOWLIST.has(t));
  if (bad.length === 0) return null;
  return `Ticker(s) not available in landing preview: ${bad.join(", ")}. Demo supports MAG7 only: ${Array.from(MAG7_ALLOWLIST).join(", ")}.`;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "Service unavailable",
        message: "AI chat demo is not configured (missing OPENAI_API_KEY).",
      },
      { status: 503, headers: corsHeaders },
    );
  }

  const ip = ipFromRequest(request);
  const limit = checkRateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: `Demo limited to ${MAX_MSGS_PER_HOUR} messages per hour. Create an API key for unlimited access.`,
        reset_at: new Date(limit.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "X-RateLimit-Limit": String(MAX_MSGS_PER_HOUR),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
        },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", message: "Expected JSON body" },
      { status: 400, headers: corsHeaders },
    );
  }

  const validation = ChatPostSchema.safeParse(raw);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        message: validation.error.issues[0]?.message ?? "Validation failed",
      },
      { status: 400, headers: corsHeaders },
    );
  }

  const { messages: userMessages } = validation.data;

  const fetchStart = performance.now();
  const requestId = `landing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let runResult;
  try {
    runResult = await runChatAgent({
      userMessages,
      model: LANDING_MODEL,
      userId: "landing-demo",
      requestId,
      maxToolRounds: LANDING_MAX_ROUNDS,
      maxCompletionTokens: LANDING_MAX_TOKENS,
      allowedToolNames: ALLOWED_TOOLS,
      skipBilling: true,
      preFlightGuard: mag7Guard,
      execParallel: true,
    });
  } catch (e) {
    if (e instanceof AgentUpstreamError) {
      console.error("[landing-chat]", e);
      return NextResponse.json(
        { error: "Upstream AI error", message: e.message },
        { status: 502, headers: corsHeaders },
      );
    }
    throw e;
  }

  const latency = Math.round(performance.now() - fetchStart);
  const { finalContent, model, usage, toolCallResults } = runResult;

  return NextResponse.json(
    {
      message: {
        role: "assistant" as const,
        content: finalContent,
      },
      model,
      usage,
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
      _demo: {
        demo_mode: true,
        allowed_tickers: Array.from(MAG7_ALLOWLIST),
        messages_remaining: limit.remaining,
        reset_at: new Date(limit.resetAt).toISOString(),
        latency_ms: latency,
      },
    },
    {
      headers: {
        ...corsHeaders,
        "X-RateLimit-Limit": String(MAX_MSGS_PER_HOUR),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
      },
    },
  );
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
