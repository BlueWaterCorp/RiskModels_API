import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { isUpstashRedisConfigured } from '@/lib/upstash-redis-config';

const PLAYGROUND_METRICS_RPM = 10;

let _limiter: Ratelimit | null | undefined;

function getPlaygroundMetricsLimiter(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  _limiter = null;
  if (!isUpstashRedisConfigured()) return _limiter;
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  _limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(PLAYGROUND_METRICS_RPM, '60 s'),
    prefix: 'rl:playground:metrics',
  });
  return _limiter;
}

export async function checkPlaygroundMetricsRateLimit(
  userId: string,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const lim = getPlaygroundMetricsLimiter();
  if (!lim) return { ok: true };
  try {
    const r = await lim.limit(`uid:${userId}`);
    if (r.success) return { ok: true };
    const retryAfterSec = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return { ok: false, retryAfterSec };
  } catch (err) {
    console.error('[playground-metrics-rl] fail open', err);
    return { ok: true };
  }
}
