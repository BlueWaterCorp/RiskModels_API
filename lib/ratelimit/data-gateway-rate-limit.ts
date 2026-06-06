import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";

/**
 * EODHD Exhibit B(g) safeguard — anti-scraping throttle for the data gateway.
 *
 * The `/api/data/*` gateway uses soft auth (`verifyGatewayAuth`) and does NOT go
 * through `withBilling`, so it has no per-key rate limiter. Without a throttle a
 * client could systematically harvest the derived surface (and probe raw fields)
 * symbol-by-symbol. This adds a per-IP sliding window at the middleware
 * chokepoint, mirroring the existing playground limiter.
 *
 * - First-party server-to-server callers (the gateway service key) are exempt —
 *   SSR, sync jobs, and internal fan-out must not be throttled.
 * - Fails OPEN if Upstash is unconfigured or unavailable (same posture as the
 *   billing limiter): availability over enforcement.
 */

const DATA_GATEWAY_RPM = Number(process.env.DATA_GATEWAY_RPM ?? 120);

let _limiter: Ratelimit | null | undefined;

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
  const lim = getLimiter();
  if (!lim) return { ok: true };
  try {
    const r = await lim.limit(`ip:${clientIp(headers)}`);
    if (r.success) return { ok: true };
    const retryAfterSec = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return { ok: false, retryAfterSec, limit: DATA_GATEWAY_RPM };
  } catch (err) {
    console.error("[data-gateway-rl] fail open", err);
    return { ok: true };
  }
}
