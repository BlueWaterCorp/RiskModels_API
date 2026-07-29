import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";
import { checkMemoryRateLimit } from "@/lib/ratelimit/memory-fallback";
import { getCorsHeaders } from "@/lib/cors";
import { ChatPostSchema } from "@/lib/api/schemas";
import { runChatAgent, AgentUpstreamError } from "@/lib/chat/agent-runner";
import { resolveAgentBackend, hasChatBackend } from "@/lib/chat/llm-backend";

/**
 * POST /api/landing/chat — unauthenticated MAG7-only preview of the
 * agentic risk analyst. Wraps the same runChatAgent() loop as
 * POST /api/chat but:
 *
 *   - Skips per-tool billing (skipBilling: true, no deductBalance).
 *   - Restricts the tool registry to a tight subset (search_tickers,
 *     get_risk_metrics, get_correlation, get_rankings, get_fundamentals).
 *     get_fundamentals is in the demo deliberately: the OpenBB copilot is
 *     structurally keyless (OpenBB never forwards the backend key to agent
 *     queries), so this route is the ONLY agent path in OpenBB Workspace —
 *     without the tool the model answers cost-of-capital questions from
 *     recalled third-party estimates instead of our PIT surface.
 *   - preFlightGuard rejects any tool arg that references a non-MAG7
 *     ticker — except get_fundamentals, which is full-universe in the
 *     demo (traction-first: PIT fundamentals are the acquisition surface;
 *     marginal cost is a GCS zarr read bounded by the per-IP cap).
 *   - Caps tool rounds at 2 and max_tokens at ~700 to bound LLM spend.
 *   - Per-IP throttle: MAX_MSGS_PER_HOUR per IP, Redis-backed (Upstash) so
 *     the cap is global rather than per-instance, degrading to a per-instance
 *     in-memory ceiling if Redis is unavailable. See checkRateLimit below.
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
  "get_fundamentals",
] as const;

// Model + client come from resolveAgentBackend() (Moonshot/Kimi when
// MOONSHOT_API_KEY is set, else Claude/OpenAI) — shared with /api/chat.
const LANDING_MAX_ROUNDS = 2;
const LANDING_MAX_TOKENS = 700;
const MAX_MSGS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

function ipFromRequest(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Per-IP cap on an UNAUTHENTICATED endpoint that spends real LLM tokens.
 *
 * Redis-backed so the cap is global rather than per-instance — the previous
 * `globalThis` Map meant the true ceiling was (MAX_MSGS_PER_HOUR × live Vercel
 * instances), which for a metered vendor bill is the wrong kind of surprise.
 *
 * If Upstash is unconfigured or throws we fall back to that same in-process
 * ceiling rather than allowing the request: a Redis outage should degrade this
 * limit, never remove it. `middleware.ts` throttles `/api/data/*` only, so this
 * is the sole control on this route.
 */
let _chatLimiter: Ratelimit | null | undefined;
function getChatLimiter(): Ratelimit | null {
  if (_chatLimiter !== undefined) return _chatLimiter;
  _chatLimiter = null;
  if (!isUpstashRedisConfigured()) return _chatLimiter;
  _chatLimiter = new Ratelimit({
    redis: new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(MAX_MSGS_PER_HOUR, "1 h"),
    prefix: "rl:landing-chat",
  });
  return _chatLimiter;
}

function memoryChatLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const r = checkMemoryRateLimit(`landing-chat:ip:${ip}`, MAX_MSGS_PER_HOUR, WINDOW_MS);
  return { ok: r.ok, remaining: r.remaining, resetAt: r.resetAt };
}

async function checkRateLimit(
  ip: string,
): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
  const lim = getChatLimiter();
  if (!lim) return memoryChatLimit(ip);
  try {
    const r = await lim.limit(`ip:${ip}`);
    return { ok: r.success, remaining: r.remaining, resetAt: r.reset };
  } catch (err) {
    console.error(
      "[landing-chat] FAIL_OPEN reason=upstash_error — degrading to per-instance memory limit",
      err,
    );
    return memoryChatLimit(ip);
  }
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
  // get_fundamentals is full-universe in the demo (traction-first ruling,
  // 2026-07-11): zero marginal vendor cost (GCS zarr read; licensing-gated
  // rows), spend bounded by the per-IP hourly cap and round/token caps.
  // Every other tool stays MAG7-gated.
  if (toolName === "get_fundamentals") return null;
  const tickers = extractTickersFromArgs(toolName, args);
  if (tickers.length === 0) return null;
  const bad = tickers.filter((t) => !MAG7_ALLOWLIST.has(t));
  if (bad.length === 0) return null;
  return `Ticker(s) not available in landing preview: ${bad.join(", ")}. Demo supports MAG7 only: ${Array.from(MAG7_ALLOWLIST).join(", ")}.`;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (!hasChatBackend()) {
    return NextResponse.json(
      {
        error: "Service unavailable",
        message:
          "AI chat demo is not configured (need MOONSHOT_API_KEY or ANTHROPIC_API_KEY).",
      },
      { status: 503, headers: corsHeaders },
    );
  }

  const ip = ipFromRequest(request);
  const limit = await checkRateLimit(ip);
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

  const backend = resolveAgentBackend();

  let runResult;
  try {
    runResult = await runChatAgent({
      userMessages,
      model: backend.model,
      openai: backend.openai,
      userId: "landing-demo",
      requestId,
      maxToolRounds: LANDING_MAX_ROUNDS,
      maxCompletionTokens: LANDING_MAX_TOKENS,
      allowedToolNames: ALLOWED_TOOLS,
      skipBilling: true,
      // Unauthenticated demo: Exhibit B(e) permits raw close/market cap only in
      // authenticated environments, so tool results are stripped to derived.
      rawFieldsPermitted: false,
      preFlightGuard: mag7Guard,
      execParallel: true,
      allowParallelOpenAI: backend.allowParallel,
      omitParallelToolCalls: backend.omitParallelToolCalls,
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
