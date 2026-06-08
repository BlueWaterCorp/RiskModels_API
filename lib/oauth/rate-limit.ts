/**
 * IP rate limiter for the unauthenticated OAuth AS endpoints (register, token,
 * revoke). Fixed-window counter on Upstash Redis with an in-memory fallback
 * when Redis isn't configured (dev). Best-effort: never blocks a request on a
 * limiter error — fails open.
 */
import { redis } from "@/lib/cache/redis";

const memoryHits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

/**
 * @param bucket   logical name, e.g. "register" | "token"
 * @param id       per-caller id (usually the client IP)
 * @param limit    max requests per window
 * @param windowSec window length in seconds
 */
export async function rateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const key = `riskmodels:oauth:rl:${bucket}:${id}`;

  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfter: windowSec };
    } catch (e) {
      console.error("[oauth/rate-limit] redis error (failing open):", e);
      return { ok: true, remaining: limit, retryAfter: 0 };
    }
  }

  // In-memory fallback (single instance only — fine for dev / Redis-less).
  const now = Date.now();
  const cur = memoryHits.get(key);
  if (!cur || cur.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    if (memoryHits.size > 5000) {
      for (const [k, v] of memoryHits) if (v.resetAt <= now) memoryHits.delete(k);
    }
    return { ok: true, remaining: limit - 1, retryAfter: windowSec };
  }
  cur.count += 1;
  return {
    ok: cur.count <= limit,
    remaining: Math.max(0, limit - cur.count),
    retryAfter: Math.ceil((cur.resetAt - now) / 1000),
  };
}
