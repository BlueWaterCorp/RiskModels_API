import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";
import { checkMemoryRateLimit } from "@/lib/ratelimit/memory-fallback";

/**
 * EODHD Exhibit B(g) safeguard — anti-scraping throttle for the data gateway.
 *
 * The `/api/data/*` gateway is public read (see `resolveGatewayRole`) and does
 * NOT go through `withBilling`, so it has no per-key rate limiter. Without a
 * throttle a client could systematically harvest the derived surface
 * symbol-by-symbol. This adds a per-IP sliding window at the middleware
 * chokepoint, mirroring the existing playground limiter.
 *
 * - First-party server-to-server callers (the gateway service key) are exempt —
 *   SSR, sync jobs, and internal fan-out must not be throttled.
 * - It DEGRADES rather than failing open. If Upstash is unconfigured or throws,
 *   it falls back to a per-instance in-memory ceiling
 *   (`lib/ratelimit/memory-fallback.ts`) instead of waving every request
 *   through. This is a licensing obligation, not a nice-to-have, so the control
 *   must not vanish on a Redis outage.
 * - Every fallback is logged as `[data-gateway-rl] FAIL_OPEN` — a distinct,
 *   greppable token. There is no Sentry/Datadog wiring in this repo, so that
 *   log line is the alerting surface; add a log-drain alert on the token.
 */

const DATA_GATEWAY_RPM = Number(process.env.DATA_GATEWAY_RPM ?? 120);

let _limiter: Ratelimit | null | undefined;
/** One-shot guard so the "unconfigured" fallback logs once, not per request. */
let _warnedUnconfigured = false;

function getLimiter(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  _limiter = null;
  if (!isUpstashRedisConfigured()) return _limiter;
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  _limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(DATA_GATEWAY_RPM, "60 s"),
    prefix: "rl:data-gateway",
  });
  return _limiter;
}

/** True when the request carries the gateway service key (first-party, exempt). */
function isServiceKey(authHeader: string | null): boolean {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;
  if (!key || !authHeader) return false;
  return authHeader.replace(/^Bearer\s+/i, "").trim() === key;
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export interface DataGatewayRateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
  limit?: number;
}

/**
 * Check the data-gateway rate limit for a request. Returns `{ ok: true }` for
 * exempt (service key), unconfigured (dev), or under-limit requests; otherwise
 * `{ ok: false, retryAfterSec, limit }`.
 */
export async function checkDataGatewayRateLimit(
  headers: Headers,
): Promise<DataGatewayRateLimitResult> {
  if (isServiceKey(headers.get("authorization"))) return { ok: true };

  const ip = clientIp(headers);
  const lim = getLimiter();

  if (!lim) {
    // Upstash not configured (local dev, or a missing env var in prod). This is
    // a static condition, so log once per process rather than per request —
    // otherwise the signal is buried in its own noise.
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true;
      console.error(
        "[data-gateway-rl] FAIL_OPEN reason=unconfigured — degrading to per-instance memory limit (logged once per instance)",
      );
    }
    return memoryFallback(ip);
  }

  try {
    const r = await lim.limit(`ip:${ip}`);
    if (r.success) return { ok: true };
    const retryAfterSec = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return { ok: false, retryAfterSec, limit: DATA_GATEWAY_RPM };
  } catch (err) {
    console.error(
      "[data-gateway-rl] FAIL_OPEN reason=upstash_error — degrading to per-instance memory limit",
      err,
    );
    return memoryFallback(ip);
  }
}

/**
 * Degraded mode: per-instance ceiling so an Upstash outage bounds the surface
 * instead of removing the safeguard entirely. Deliberately generous relative to
 * the Redis limit — this is a blast-radius cap, not accurate accounting.
 */
function memoryFallback(ip: string): DataGatewayRateLimitResult {
  const r = checkMemoryRateLimit(`data-gateway:ip:${ip}`, DATA_GATEWAY_RPM, 60_000);
  if (r.ok) return { ok: true };
  return { ok: false, retryAfterSec: r.retryAfterSec, limit: DATA_GATEWAY_RPM };
}
