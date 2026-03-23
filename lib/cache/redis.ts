/**
 * Redis Cache Client
 *
 * Uses Upstash Redis for edge-compatible caching.
 * Falls back to in-memory cache if Redis is not configured.
 */

import { Redis } from "@upstash/redis";

// Check if Redis is configured
const hasRedisConfig =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

// Initialize Redis client if configured
export const redis = hasRedisConfig
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// In-memory fallback for development or if Redis is not configured
const memoryCache = new Map<string, { value: any; expiresAt: number }>();

/**
 * Cache TTL options (in seconds)
 */
export const CACHE_TTL = {
  // Short-lived: Real-time data
  REALTIME: 60, // 1 minute

  // Medium-lived: Frequently changing data
  FREQUENT: 300, // 5 minutes

  // Standard: Daily data
  DAILY: 3600, // 1 hour

  // Long-lived: Historical data
  HISTORICAL: 86400, // 24 hours

  // Static: Metadata, tickers
  STATIC: 604800, // 7 days

  // Permanent: Schemas, capabilities
  PERMANENT: 2592000, // 30 days
} as const;

/**
 * Generate cache key with namespace
 */
export function generateCacheKey(
  namespace: string,
  identifier: string,
  params?: Record<string, any>,
): string {
  const baseKey = `riskmodels:${namespace}:${identifier}`;

  if (!params || Object.keys(params).length === 0) {
    return baseKey;
  }

  // Sort params for consistent keys
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(":");

  return `${baseKey}:${sortedParams}`;
}

/**
 * Get value from cache
 */
export async function getCache<T>(key: string): Promise<T | null> {
  // Try Redis first
  if (redis) {
    try {
      const value = await redis.get<T>(key);
      return value;
    } catch (error) {
      console.error("[Cache] Redis get error:", error);
    }
  }

  // Fallback to memory cache
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  // Clean up expired entry
  if (cached) {
    memoryCache.delete(key);
  }

  return null;
}

/**
 * Set value in cache
 */
export async function setCache<T>(
  key: string,
  value: T,
  ttlSeconds: number = CACHE_TTL.DAILY,
): Promise<void> {
  // Try Redis first
  if (redis) {
    try {
      await redis.setex(key, ttlSeconds, value);
      return;
    } catch (error) {
      console.error("[Cache] Redis set error:", error);
    }
  }

  // Fallback to memory cache
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  // Clean up old entries if cache gets too large
  if (memoryCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (v.expiresAt <= now) {
        memoryCache.delete(k);
      }
    }
  }
}

/**
 * Delete value from cache
 */
export async function deleteCache(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error("[Cache] Redis del error:", error);
    }
  }

  memoryCache.delete(key);
}

/**
 * Delete multiple keys by pattern (Redis only)
 */
export async function deleteCachePattern(pattern: string): Promise<void> {
  if (redis) {
    try {
      // Upstash Redis doesn't support KEYS, use scan instead
      let cursor: number | string = 0;
      const keysToDelete: string[] = [];

      do {
        const [newCursor, keys] = (await redis.scan(cursor, {
          match: pattern,
          count: 100,
        })) as [number | string, string[]];
        cursor = newCursor;
        keysToDelete.push(...keys);
      } while (cursor !== 0 && cursor !== "0");

      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
      }
    } catch (error) {
      console.error("[Cache] Redis pattern delete error:", error);
    }
  }

  // Memory cache: iterate and delete matching keys
  const regex = new RegExp(pattern.replace("*", ".*"));
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Get or compute value from cache
 */
export async function getOrCompute<T>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.DAILY,
): Promise<T> {
  // Try cache first
  const cached = await getCache<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Compute value
  const value = await compute();

  // Store in cache (don't await, let it happen in background)
  setCache(key, value, ttlSeconds).catch(console.error);

  return value;
}

/**
 * Check if cache is available
 */
export function isCacheAvailable(): boolean {
  return redis !== null || memoryCache !== undefined;
}

/**
 * Get cache statistics (for monitoring)
 */
export async function getCacheStats(): Promise<{
  redis_connected: boolean;
  memory_cache_size: number;
}> {
  return {
    redis_connected: redis !== null,
    memory_cache_size: memoryCache.size,
  };
}

/**
 * Cache warming utility
 * Pre-populates cache with frequently accessed data
 */
export async function warmCache(
  items: Array<{
    key: string;
    fetcher: () => Promise<any>;
    ttl: number;
  }>,
): Promise<void> {
  await Promise.all(
    items.map(async ({ key, fetcher, ttl }) => {
      try {
        const value = await fetcher();
        await setCache(key, value, ttl);
      } catch (error) {
        console.error(`[Cache] Failed to warm cache for ${key}:`, error);
      }
    }),
  );
}
