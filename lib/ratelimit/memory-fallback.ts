/**
 * Per-instance in-memory rate limiter — the floor under the Upstash limiters.
 *
 * The Redis-backed limiters (`data-gateway-rate-limit`, the billing middleware's
 * per-key limiter) fail OPEN: if Upstash is unconfigured or throws, they return
 * `{ ok: true }` and the surface becomes completely unthrottled. For a licensing
 * safeguard (EODHD Exhibit B(g)) or an unauthenticated LLM-spend endpoint, that
 * is the wrong failure mode — the control should DEGRADE, not disappear.
 *
 * This module provides that degraded mode. It is deliberately weak:
 *
 *   - State lives in `globalThis`, so on Vercel the effective ceiling is
 *     (limit × live instances), not `limit`. It is a blast-radius cap, not an
 *     accurate limiter.
 *   - It resets whenever an instance recycles.
 *
 * That is fine for its job: turning "unbounded" into "bounded by something".
 * When Redis is healthy the Upstash limiter answers first and this never runs.
 */

type Bucket = { count: number; resetAt: number };

const BUCKETS: Map<string, Bucket> =
  (globalThis as { __rmMemoryRateBuckets?: Map<string, Bucket> })
    .__rmMemoryRateBuckets ?? new Map();
(globalThis as { __rmMemoryRateBuckets?: Map<string, Bucket> }).__rmMemoryRateBuckets =
  BUCKETS;

/** Evict expired buckets so a long-lived instance cannot grow the map without bound. */
function sweep(now: number): void {
  if (BUCKETS.size < 10_000) return;
  for (const [k, b] of BUCKETS) {
    if (b.resetAt <= now) BUCKETS.delete(k);
  }
}

export interface MemoryRateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

/**
 * Consume one token from a per-instance fixed window.
 *
 * @param key      Bucket key — namespace it (e.g. `data-gateway:ip:1.2.3.4`).
 * @param limit    Max requests per window for this instance.
 * @param windowMs Window length in milliseconds.
 */
export function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): MemoryRateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    BUCKETS.set(key, bucket);
    return {
      ok: true,
      remaining: Math.max(0, limit - 1),
      resetAt: bucket.resetAt,
      retryAfterSec: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec,
  };
}

/** Test seam — drops all in-memory buckets. */
export function __resetMemoryRateLimits(): void {
  BUCKETS.clear();
}
