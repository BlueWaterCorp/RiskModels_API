/**
 * ERM3-97: with Redis unconfigured in production, a fail-closed purge cannot
 * reach the shared cache, so it must fail rather than report the in-memory
 * count as a successful purge. Outside production the memory-only purge stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/upstash-redis-config", () => ({
  isUpstashRedisConfigured: () => false,
}));

import { deleteCachePattern } from "@/lib/cache/redis";

const PATTERN = "riskmodels:fundamentals_zarr:*";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deleteCachePattern without Redis", () => {
  it("throws for a fail-closed purge in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(deleteCachePattern(PATTERN, { failOnError: true })).rejects.toThrow(/not configured/);
  });

  it("keeps the memory-only purge outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await expect(deleteCachePattern(PATTERN, { failOnError: true })).resolves.toBe(0);
  });

  it("keeps best-effort callers unchanged in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(deleteCachePattern(PATTERN)).resolves.toBe(0);
  });
});
