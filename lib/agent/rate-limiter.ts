/**
 * Rate Limiting Service
 * 
 * Implements per-API-key rate limiting using Upstash Redis.
 * Uses a sliding window counter pattern with 1-minute windows.
 */

import { env } from "@/lib/env";
import { isUpstashRedisConfigured } from "@/lib/upstash-redis-config";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

/**
 * Check rate limit for a given API key or user ID.
 * Returns whether the request should be allowed and metadata about the limit.
 */
export async function checkRateLimit(
  identifier: string,
  limitPerMinute: number = 60
): Promise<RateLimitResult> {
  // If Redis is not configured (or only placeholders), allow all requests (dev mode)
  if (!isUpstashRedisConfigured()) {
    console.warn("[RateLimit] Redis not configured, rate limiting disabled");
    return {
      allowed: true,
      remaining: limitPerMinute,
      resetAt: new Date(Date.now() + 60000),
      limit: limitPerMinute,
    };
  }

  try {
    // Create a key based on the current minute window
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const key = `rm:rate:${identifier}:${currentMinute}`;
    
    // Increment the counter for this minute window
    const response = await fetch(
      `${env.UPSTASH_REDIS_REST_URL}/pipeline`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, 60], // Expire after 60 seconds
        ]),
      }
    );

    if (!response.ok) {
      throw new Error(`Redis request failed: ${response.status}`);
    }

    const results = await response.json();
    const count = results[0]?.result || 0;

    const allowed = count <= limitPerMinute;
    const remaining = Math.max(0, limitPerMinute - count);
    const resetAt = new Date((currentMinute + 1) * 60000);

    if (!allowed) {
      console.warn(
        `[RateLimit] Rate limit exceeded for ${identifier}: ${count}/${limitPerMinute}`
      );
    }

    return {
      allowed,
      remaining,
      resetAt,
      limit: limitPerMinute,
    };
  } catch (error) {
    console.error("[RateLimit] Error checking rate limit:", error);
    // On error, allow the request to proceed (fail open)
    return {
      allowed: true,
      remaining: limitPerMinute,
      resetAt: new Date(Date.now() + 60000),
      limit: limitPerMinute,
    };
  }
}

/**
 * Extract rate limit from API key metadata or use default.
 */
export function getRateLimitForKey(scopes?: string[]): number {
  // Default rate limit
  const DEFAULT_RATE_LIMIT = 60;
  
  // Check if scopes include a rate limit override
  // Format: "rate:120" means 120 requests per minute
  if (scopes) {
    const rateLimitScope = scopes.find((s) => s.startsWith("rate:"));
    if (rateLimitScope) {
      const limit = parseInt(rateLimitScope.split(":")[1], 10);
      if (!isNaN(limit) && limit > 0) {
        return limit;
      }
    }
  }
  
  return DEFAULT_RATE_LIMIT;
}
