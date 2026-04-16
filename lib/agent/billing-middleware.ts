/**
 * Per-Request Billing Middleware
 *
 * Wraps API handlers to enforce per-request billing:
 * - Checks balance before processing
 * - Deducts cost after successful request
 * - Returns HTTP 402 if insufficient balance
 * - Logs billing events for telemetry
 */

import { NextRequest, NextResponse } from "next/server";
import { getCapability, calculateEstimatedCost } from "./capabilities";
import {
  checkBalance,
  deductBalance,
  ensureMinimumBalanceForUserKeyHolder,
  ensureStarterCredits,
  getUserBalance,
} from "./billing";
import { createPaymentRequiredResponse, createMonthlyCapExceededResponse } from "./errors";
import { generateRequestId, logTelemetry } from "./telemetry";
import { extractApiKey, validateApiKey } from "./api-keys";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";
import { checkFreeTierLimit, incrementFreeTierUsage } from "./free-tier";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Check if user has exceeded their monthly spend cap
 */
async function checkMonthlySpendCap(
  userId: string,
  requestedCost: number
): Promise<{
  exceeded: boolean;
  currentSpend: number;
  cap: number | null;
  resetAt: Date;
}> {
  try {
    const supabase = createAdminClient();

    // Call the RPC to check and potentially reset monthly spend
    await supabase.rpc("check_reset_monthly_spend", { p_user_id: userId });

    // Get current spend and cap
    const { data: account } = await supabase
      .from("agent_accounts")
      .select("monthly_spend_cap, monthly_spend_usd, monthly_spend_reset_at")
      .eq("user_id", userId)
      .single();

    if (!account || account.monthly_spend_cap === null) {
      // No cap set, allow unlimited
      return {
        exceeded: false,
        currentSpend: account?.monthly_spend_usd ? parseFloat(account.monthly_spend_usd) : 0,
        cap: null,
        resetAt: account?.monthly_spend_reset_at ? new Date(account.monthly_spend_reset_at) : new Date(),
      };
    }

    const cap = parseFloat(account.monthly_spend_cap);
    const currentSpend = parseFloat(account.monthly_spend_usd);
    const projectedSpend = currentSpend + requestedCost;

    return {
      exceeded: projectedSpend > cap,
      currentSpend,
      cap,
      resetAt: new Date(account.monthly_spend_reset_at),
    };
  } catch (error) {
    console.error("[Billing] Error checking monthly spend cap:", error);
    // Fail open (allow request) if we can't check the cap
    return {
      exceeded: false,
      currentSpend: 0,
      cap: null,
      resetAt: new Date(),
    };
  }
}

/**
 * Check if user has exceeded their daily spend cap (UTC day).
 * Primary defense against runaway agent loops hammering the API.
 */
async function checkDailySpendCap(
  userId: string,
  requestedCost: number,
): Promise<{
  exceeded: boolean;
  currentSpend: number;
  cap: number | null;
}> {
  try {
    const supabase = createAdminClient();
    await supabase.rpc("check_reset_daily_spend", { p_user_id: userId });
    const { data: account } = await supabase
      .from("agent_accounts")
      .select("daily_spend_cap, daily_spend_usd")
      .eq("user_id", userId)
      .single();

    if (!account || account.daily_spend_cap === null) {
      return {
        exceeded: false,
        currentSpend: account?.daily_spend_usd ? parseFloat(account.daily_spend_usd) : 0,
        cap: null,
      };
    }

    const cap = parseFloat(account.daily_spend_cap);
    const currentSpend = parseFloat(account.daily_spend_usd);
    return {
      exceeded: currentSpend + requestedCost > cap,
      currentSpend,
      cap,
    };
  } catch (error) {
    console.error("[Billing] Error checking daily spend cap:", error);
    return { exceeded: false, currentSpend: 0, cap: null };
  }
}

// Lazy singleton — only initialised when Upstash env vars are present
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  if (isUpstashRedisConfigured()) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

// Cache Ratelimit instances keyed by limit value so we re-use the same limiter
// for keys with the same rate limit setting.
const _limiters = new Map<number, Ratelimit>();
function getRatelimiter(requestsPerMinute: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null; // Fall back gracefully when Redis is not configured
  if (!_limiters.has(requestsPerMinute)) {
    _limiters.set(
      requestsPerMinute,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(requestsPerMinute, "60 s"),
        prefix: "rl:billing",
      }),
    );
  }
  return _limiters.get(requestsPerMinute)!;
}

type RatelimitResult = Awaited<ReturnType<Ratelimit["limit"]>>;

/** Upstash may reject requests (wrong token, outage). Never take the whole API down — skip RL. */
async function tryRatelimit(
  limiter: Ratelimit,
  key: string,
): Promise<RatelimitResult | null> {
  try {
    return await limiter.limit(key);
  } catch (err) {
    console.error("[Billing] Rate limiter error (fail open):", err);
    return null;
  }
}

export interface BillingOptions {
  capabilityId: string;
  itemCount?: number;
  /** Resolve item count from request (e.g. for batch endpoints). Uses cloned request to avoid consuming body. */
  getItemCount?: (req: NextRequest) => Promise<number | undefined> | number | undefined;
  /** For per-token capabilities (e.g. chat): estimate tokens from a cloned request body before billing. */
  getTokenEstimates?: (
    req: NextRequest,
  ) => Promise<{ inputTokens?: number; outputTokens?: number } | undefined>;
  inputTokens?: number;
  outputTokens?: number;
  skipBilling?: boolean; // For free endpoints or internal use
  /**
   * When `skipBilling` is true, optionally still rate-limit by caller IP (Upstash Redis).
   * Use for public JSON intended for Shields.io or README embeds so traffic does not bypass all limits.
   */
  publicIpRateLimitPerMinute?: number;
}

export interface BillingContext {
  userId: string;
  requestId: string;
  capabilityId: string;
  costUsd: number;
  startTime: number;
  apiKey?: string;
  tier?: "free" | "paid" | "enterprise";
  freeTierStatus?: any;
}

/**
 * Middleware to enforce per-request billing
 *
 * Usage:
 * ```typescript
 * export const GET = withBilling(
 *   async (req, context) => {
 *     // Your handler logic
 *     return NextResponse.json(data);
 *   },
 *   { capabilityId: 'ticker-returns' }
 * );
 * ```
 */
export function withBilling(
  handler: (req: NextRequest, context: BillingContext) => Promise<NextResponse>,
  options: BillingOptions,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const startTime = Date.now();
    const requestId = generateRequestId();

    // Skip billing if configured (for free endpoints)
    if (options.skipBilling) {
      const rpm = options.publicIpRateLimitPerMinute;
      if (rpm != null && rpm > 0) {
        const limiter = getRatelimiter(rpm);
        if (limiter) {
          const forwarded = req.headers.get("x-forwarded-for");
          const ipRaw =
            forwarded?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            req.headers.get("cf-connecting-ip") ||
            "unknown";
          const ip = ipRaw.slice(0, 128);
          const rl = await tryRatelimit(
            limiter,
            `public:${options.capabilityId}:${ip}`,
          );
          if (rl && !rl.success) {
            const { limit, remaining, reset } = rl;
            const retryAfterSecs = Math.ceil((reset - Date.now()) / 1000);
            // 200 so Shields.io Endpoint badges show a grey error badge instead of a transport failure
            return new NextResponse(
              JSON.stringify({
                schemaVersion: 1,
                isError: true,
                label: "riskmodels",
                message: "rate limited",
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(retryAfterSecs),
                  "X-RateLimit-Limit": String(limit),
                  "X-RateLimit-Remaining": String(remaining),
                  "X-RateLimit-Reset": String(reset),
                },
              },
            );
          }
        }
      }

      const context: BillingContext = {
        userId: "",
        requestId,
        capabilityId: options.capabilityId,
        costUsd: 0,
        startTime,
      };

      const response = await handler(req, context);

      // Add telemetry headers even for free requests
      response.headers.set("X-Request-ID", requestId);
      response.headers.set(
        "X-Response-Latency-Ms",
        String(Date.now() - startTime),
      );
      response.headers.set("X-API-Cost-USD", "0");
      const skipCapability = getCapability(options.capabilityId);
      if (skipCapability) {
        response.headers.set("X-Pricing-Tier", skipCapability.pricing.tier);
      }

      return response;
    }

    try {
      // 1. Authenticate the request (try API key first, then session)
      let userId: string | undefined;
      let apiKey: string | undefined;

      // Try API key authentication first
      const extractedKey = extractApiKey(req);
      let apiKeyRateLimit: number | undefined;
      let apiKeyDailyCapOverride: number | null = null;
      let apiKeyScope: string | null = null;
      if (extractedKey) {
        const validation = await validateApiKey(extractedKey);
        if (validation.valid && validation.userId) {
          userId = validation.userId;
          apiKey = extractedKey;
          apiKeyRateLimit = validation.rateLimit ?? undefined;
          apiKeyDailyCapOverride = validation.dailySpendCapUsd ?? null;
          apiKeyScope = validation.keyScope ?? null;
        }
      }

      // Fall back to session authentication
      if (!userId) {
        const { user, error: authError } = await authenticateRequest(req);
        if (!user || authError) {
          return NextResponse.json(
            {
              error: "Unauthorized",
              message: "Valid API key or authentication required",
              _agent: {
                action: "authenticate",
                authenticate_url: "/api/auth/provision",
              },
            },
            { status: 401 },
          );
        }
        userId = user.id;
      }

      // 1b. Enforce per-key rate limit (API key requests only).
      // Capture rl result for later success-path headers so agents can self-throttle.
      let rateLimitResult: RatelimitResult | null = null;
      if (apiKey && apiKeyRateLimit && apiKeyRateLimit > 0) {
        const limiter = getRatelimiter(apiKeyRateLimit);
        if (limiter) {
          const rl = await tryRatelimit(limiter, apiKey);
          rateLimitResult = rl;
          if (rl && !rl.success) {
            const { limit, remaining, reset } = rl;
            const retryAfterSecs = Math.ceil((reset - Date.now()) / 1000);
            return new NextResponse(
              JSON.stringify({
                error: "Too Many Requests",
                message: `Rate limit of ${limit} requests/minute exceeded. Retry after ${retryAfterSecs}s.`,
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(retryAfterSecs),
                  "X-RateLimit-Limit": String(limit),
                  "X-RateLimit-Remaining": String(remaining),
                  "X-RateLimit-Reset": String(reset),
                },
              },
            );
          }
        }
      }

      // 2. Calculate expected cost
      const capability = getCapability(options.capabilityId);
      if (!capability) {
        return NextResponse.json(
          {
            error: "Unknown capability",
            message: `Capability '${options.capabilityId}' not found`,
            _agent: {
              action: "contact_support",
            },
          },
          { status: 400 },
        );
      }

      let itemCount = options.itemCount;
      if (options.getItemCount) {
        const resolved = await options.getItemCount(req);
        if (resolved !== undefined) itemCount = resolved;
      }

      let inputTokens = options.inputTokens;
      let outputTokens = options.outputTokens;
      if (options.getTokenEstimates) {
        try {
          const est = await options.getTokenEstimates(req);
          if (est?.inputTokens !== undefined) inputTokens = est.inputTokens;
          if (est?.outputTokens !== undefined) outputTokens = est.outputTokens;
        } catch {
          // Fall back to static options / zero
        }
      }

      let costUsd = calculateEstimatedCost(options.capabilityId, {
        itemCount,
        inputTokens,
        outputTokens,
      });

      // Empty portfolio probe (e.g. Plaid sync not finished): no charge.
      if (options.capabilityId === "portfolio-risk-index" && itemCount === 0) {
        costUsd = 0;
      }

      // 3. Check free tier limits (if tier is free)
      let freeTierCheck: any = null;
      if (costUsd > 0) {
        freeTierCheck = await checkFreeTierLimit(userId);

        if (freeTierCheck.tier === "free" && !freeTierCheck.can_proceed) {
          return NextResponse.json(
            {
              error: "Free tier limit exceeded",
              message: freeTierCheck.reason || "Daily query limit reached",
              _agent: {
                action: "upgrade",
                upgrade_url: "/settings",
                current_usage: freeTierCheck.queries_today,
                daily_limit: freeTierCheck.limits.queries_per_day,
                reset_at:
                  freeTierCheck.remaining_today === 0 ? "tomorrow" : null,
              },
            },
            { status: 429 }, // Too Many Requests
          );
        }
      }

      // 3.5. Ensure starter credits for first-time users (before balance check)
      if (costUsd > 0) {
        await ensureStarterCredits(userId).catch(() => {});
        await ensureMinimumBalanceForUserKeyHolder(userId).catch(() => {});
      }

      // 4. Check balance and monthly spend cap (if cost > 0 and not free tier)
      // Early balance check — cheap read to give a fast 402 before running
      // the handler. The definitive atomic check happens at deduction time
      // below, so this is a best-effort short-circuit only.
      if (costUsd > 0 && freeTierCheck?.tier !== "free") {
        const currentBalance = await getUserBalance(userId);
        // Block if balance is negative (user is in debt) or insufficient
        if (currentBalance < 0 || currentBalance < costUsd) {
          const payRes = createPaymentRequiredResponse(
            costUsd,
            Math.max(0, currentBalance),
          );
          payRes.headers.set("X-Pricing-Tier", capability.pricing.tier);
          return payRes;
        }

        // Check daily spend cap first (tighter loop protection), then monthly.
        // Per-key daily cap override (e.g. rm_agent_mcp_*) takes precedence over account-level.
        const accountDaily = await checkDailySpendCap(userId, costUsd);
        const effectiveDailyCap =
          apiKeyDailyCapOverride != null && apiKeyDailyCapOverride > 0
            ? apiKeyDailyCapOverride
            : accountDaily.cap;
        const effectiveDailyExceeded =
          effectiveDailyCap != null &&
          accountDaily.currentSpend + costUsd > effectiveDailyCap;
        if (effectiveDailyExceeded && effectiveDailyCap != null) {
          const remaining = Math.max(
            0,
            effectiveDailyCap - accountDaily.currentSpend,
          );
          const capSource =
            apiKeyDailyCapOverride != null && apiKeyDailyCapOverride > 0
              ? "per_key"
              : "account";
          return NextResponse.json(
            {
              error: "Daily spend cap exceeded",
              message: `Daily spend cap of $${effectiveDailyCap.toFixed(2)} (${capSource}) reached. $${remaining.toFixed(4)} remaining today; resets at 00:00 UTC.`,
              _agent: {
                action: "wait_or_raise_cap",
                current_daily_spend_usd: accountDaily.currentSpend,
                daily_cap_usd: effectiveDailyCap,
                cap_source: capSource,
                key_scope: apiKeyScope,
                resets_at: "next 00:00 UTC",
                raise_cap_url: "/settings/billing",
              },
            },
            {
              status: 402,
              headers: {
                "X-Daily-Spend-Cap-USD": effectiveDailyCap.toFixed(2),
                "X-Current-Daily-Spend-USD": accountDaily.currentSpend.toFixed(2),
                "X-Daily-Cap-Source": capSource,
              },
            },
          );
        }

        // Check monthly spend cap
        const monthlyCapCheck = await checkMonthlySpendCap(userId, costUsd);
        if (monthlyCapCheck.exceeded && monthlyCapCheck.cap != null) {
          return createMonthlyCapExceededResponse(
            monthlyCapCheck.currentSpend,
            monthlyCapCheck.cap,
            monthlyCapCheck.resetAt
          );
        }
      }

      // 4. Create billing context
      const context: BillingContext = {
        userId,
        requestId,
        capabilityId: options.capabilityId,
        costUsd,
        startTime,
        apiKey,
        tier: freeTierCheck?.tier,
        freeTierStatus: freeTierCheck,
      };

      // 5. Process the request
      const handlerStart = Date.now();
      const response = await handler(req, context);
      const latencyMs = Date.now() - startTime;
      const fetchLatencyMs = Number(response.headers.get("X-Data-Fetch-Latency-Ms")) || (Date.now() - handlerStart);
      const agentDecisionLatencyMs = latencyMs - fetchLatencyMs;
      const success = response.status < 400;

      // 6. Atomically deduct balance on success (only if cost > 0).
      //    The deduct_balance RPC uses FOR UPDATE — immune to race conditions.
      if (costUsd > 0 && success) {
        try {
          await deductBalance(
            userId,
            costUsd,
            requestId,
            options.capabilityId,
            {
              original_url: req.url,
              user_agent: req.headers.get("user-agent"),
              ip_address: req.headers.get("x-forwarded-for") || "unknown",
            },
          );
        } catch (deductError) {
          if (
            deductError instanceof Error &&
            deductError.message === "Insufficient balance"
          ) {
            // Balance exhausted by a concurrent request — return 402
            const currentBalance = await getUserBalance(userId);
            const payRes = createPaymentRequiredResponse(costUsd, currentBalance);
            payRes.headers.set("X-Pricing-Tier", capability.pricing.tier);
            return payRes;
          }
          console.error("[Billing] Failed to deduct balance:", deductError);
        }
      }

      // 6.5. Increment free tier usage (for free tier accounts)
      if (costUsd > 0 && success && context.tier === "free") {
        await incrementFreeTierUsage(userId);
      }

      // 7. Log telemetry
      await logTelemetry({
        request_id: requestId,
        capability_id: options.capabilityId,
        user_id: userId,
        latency_ms: latencyMs,
        status_code: response.status,
        success,
        cost_usd: success ? costUsd : 0, // Only charge on success
        timestamp: new Date().toISOString(),
        metadata: {
          fetch_latency_ms: fetchLatencyMs,
          agent_decision_latency_ms: agentDecisionLatencyMs,
        },
      }).catch(console.error);

      // 8. Add billing headers to response
      response.headers.set("X-Request-ID", requestId);
      response.headers.set("X-Response-Latency-Ms", String(latencyMs));
      response.headers.set("X-Agent-Decision-Latency-Ms", String(agentDecisionLatencyMs));
      response.headers.set("X-Data-Fetch-Latency-Ms", String(fetchLatencyMs));
      response.headers.set("X-API-Cost-USD", String(success ? costUsd : 0));
      response.headers.set("X-API-Cost-Currency", "USD");
      response.headers.set(
        "X-API-Billing-Code",
        capability.pricing.billing_code,
      );
      response.headers.set("X-Pricing-Tier", capability.pricing.tier);

      // 8.1. Rate-limit headers on success so agents can self-throttle before 429.
      if (rateLimitResult) {
        response.headers.set("X-RateLimit-Limit", String(rateLimitResult.limit));
        response.headers.set("X-RateLimit-Remaining", String(rateLimitResult.remaining));
        response.headers.set("X-RateLimit-Reset", String(rateLimitResult.reset));
      }

      // 8.5. Add token bucket headers ($20 = 1M tokens, so 1 token = $0.00002)
      const TOKEN_PRICE_USD = 0.00002;
      const tokensConsumed = Math.ceil(costUsd / TOKEN_PRICE_USD);
      response.headers.set("X-Tokens-Consumed", String(tokensConsumed));
      try {
        const balanceRemaining = await getUserBalance(userId);
        const tokensRemaining = Math.floor(balanceRemaining / TOKEN_PRICE_USD);
        response.headers.set("X-Balance-Remaining", String(tokensRemaining));
      } catch (balanceHeaderErr) {
        // Never fail the response after a successful handler — balance read is best-effort for headers only
        console.error("[Billing] Failed to read balance for response headers:", balanceHeaderErr);
      }

      // 8.6. Add monthly + daily spend cap headers (if user has caps set)
      try {
        const supabase = createAdminClient();
        const { data: account } = await supabase
          .from("agent_accounts")
          .select(
            "monthly_spend_cap, monthly_spend_usd, monthly_spend_reset_at, daily_spend_cap, daily_spend_usd",
          )
          .eq("user_id", userId)
          .single();

        if (account != null && account.monthly_spend_cap != null) {
          const cap = parseFloat(String(account.monthly_spend_cap));
          const currentSpend = parseFloat(String(account.monthly_spend_usd ?? 0));
          const resetAt = new Date(account.monthly_spend_reset_at ?? Date.now());

          // Calculate next reset
          const nextReset = new Date(resetAt);
          nextReset.setMonth(nextReset.getMonth() + 1);
          nextReset.setDate(1);

          const now = new Date();
          const daysUntilReset = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

          response.headers.set("X-Monthly-Spend-Cap-USD", cap.toFixed(2));
          response.headers.set("X-Current-Monthly-Spend-USD", currentSpend.toFixed(2));
          response.headers.set("X-Monthly-Cap-Reset-At", nextReset.toISOString());
          response.headers.set("X-Days-Until-Reset", String(daysUntilReset));
        }

        if (account != null && account.daily_spend_cap != null) {
          const dailyCap = parseFloat(String(account.daily_spend_cap));
          const dailyCurrent = parseFloat(String(account.daily_spend_usd ?? 0));
          response.headers.set("X-Daily-Spend-Cap-USD", dailyCap.toFixed(2));
          response.headers.set("X-Current-Daily-Spend-USD", dailyCurrent.toFixed(2));
        }
      } catch {
        // Silently skip if we can't fetch spend cap data
      }

      return response;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Log error telemetry
      await logTelemetry({
        request_id: requestId,
        capability_id: options.capabilityId,
        latency_ms: latencyMs,
        status_code: 500,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      }).catch(console.error);

      throw error;
    }
  };
}

/**
 * Simpler middleware that just adds billing headers without enforcement
 *
 * For use with existing subscription-based billing that doesn't need
 * per-request balance checking.
 */
export function withBillingHeaders(
  handler: (req: NextRequest) => Promise<NextResponse>,
  capabilityId: string,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const startTime = Date.now();
    const requestId = generateRequestId();

    try {
      const capability = getCapability(capabilityId);
      const costUsd = calculateEstimatedCost(capabilityId);

      const response = await handler(req);
      const latencyMs = Date.now() - startTime;

      // Add billing headers
      response.headers.set("X-Request-ID", requestId);
      response.headers.set("X-Response-Latency-Ms", String(latencyMs));

      if (capability) {
        response.headers.set("X-API-Cost-USD", String(costUsd));
        response.headers.set("X-API-Cost-Currency", "USD");
        response.headers.set(
          "X-API-Billing-Code",
          capability.pricing.billing_code,
        );
        response.headers.set("X-Pricing-Tier", capability.pricing.tier);
      }

      return response;
    } catch (error) {
      throw error;
    }
  };
}

/**
 * Create a billing context for use within handlers
 *
 * Useful when you need to do billing calculations inside the handler
 * based on the actual response (e.g., per-token billing for AI).
 */
export async function createBillingContext(
  req: NextRequest,
  capabilityId: string,
): Promise<{ context: BillingContext; error?: NextResponse }> {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Authenticate
  let userId: string | undefined;

  const extractedKey = extractApiKey(req);
  if (extractedKey) {
    const validation = await validateApiKey(extractedKey);
    if (validation.valid && validation.userId) {
      userId = validation.userId;
    }
  }

  if (!userId) {
    const { user } = await authenticateRequest(req);
    if (!user) {
      return {
        context: {} as BillingContext,
        error: NextResponse.json(
          { error: "Unauthorized", _agent: { action: "authenticate" } },
          { status: 401 },
        ),
      };
    }
    userId = user.id;
  }

  const capability = getCapability(capabilityId);
  const costUsd = calculateEstimatedCost(capabilityId);

  return {
    context: {
      userId,
      requestId,
      capabilityId,
      costUsd,
      startTime,
    },
  };
}

/**
 * Finalize billing after handler completes
 *
 * Call this at the end of your handler to:
 * - Deduct balance
 * - Log telemetry
 * - Add headers
 */
export async function finalizeBilling(
  req: NextRequest,
  res: NextResponse,
  context: BillingContext,
  actualCostUsd?: number,
): Promise<NextResponse> {
  const latencyMs = Date.now() - context.startTime;
  const costUsd = actualCostUsd ?? context.costUsd;
  const success = res.status < 400;

  // Deduct balance on success
  if (costUsd > 0 && success) {
    try {
      await deductBalance(
        context.userId,
        costUsd,
        context.requestId,
        context.capabilityId,
        {
          response_status: res.status,
          actual_cost: actualCostUsd !== undefined,
        },
      );
    } catch (error) {
      console.error("[Billing] Failed to deduct balance:", error);
    }
  }

  // Log telemetry
  await logTelemetry({
    request_id: context.requestId,
    capability_id: context.capabilityId,
    user_id: context.userId,
    latency_ms: latencyMs,
    status_code: res.status,
    success,
    cost_usd: success ? costUsd : 0,
    timestamp: new Date().toISOString(),
  }).catch(console.error);

  // Add headers
  res.headers.set("X-Request-ID", context.requestId);
  res.headers.set("X-Response-Latency-Ms", String(latencyMs));
  res.headers.set("X-API-Cost-USD", String(success ? costUsd : 0));
  const capMeta = getCapability(context.capabilityId);
  if (capMeta) {
    res.headers.set("X-Pricing-Tier", capMeta.pricing.tier);
  }

  return res;
}
