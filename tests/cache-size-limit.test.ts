import { describe, expect, it } from "vitest";
import { CACHE_MAX_VALUE_BYTES, getCache, setCache } from "@/lib/cache/redis";
import { MAX_CACHED_SLICE_ROWS, estimateSliceRows } from "@/lib/dal/zarr-reader";

describe("cache size limit", () => {
  it("does not store a value larger than the limit", async () => {
    const big = { s: "x".repeat(CACHE_MAX_VALUE_BYTES + 10) };
    await setCache("test:size:big", big, 60);
    expect(await getCache("test:size:big")).toBeNull();
  });

  it("still stores a normal value", async () => {
    await setCache("test:size:small", { a: 1 }, 60);
    expect(await getCache("test:size:small")).toEqual({ a: 1 });
  });

  it("skips a value that cannot be serialized instead of throwing", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(setCache("test:size:cyclic", cyclic, 60)).resolves.toBeUndefined();
    expect(await getCache("test:size:cyclic")).toBeNull();
  });
});

describe("history slice cache threshold", () => {
  const base = { keys: ["l1_mkt_hr", "stock_var"] as never, periodicity: "daily" as const };

  it("keeps a latest-day read for one name under the threshold", () => {
    expect(estimateSliceRows({ ...base, symbols: ["A"], startDate: "2026-10-01", endDate: "2026-10-07" })).toBeLessThan(MAX_CACHED_SLICE_ROWS);
  });

  it("puts 25 names x 14 keys of full daily history far over it", () => {
    const rows = estimateSliceRows({
      symbols: Array.from({ length: 25 }, (_, i) => `S${i}`),
      keys: Array.from({ length: 14 }, (_, i) => `k${i}`) as never,
      periodicity: "daily",
      startDate: "2006-01-01",
      endDate: "2026-10-07",
    });
    // Measured 2026-10-08: that request returned 1.21M rows.
    expect(rows).toBeGreaterThan(1_000_000);
    expect(rows).toBeGreaterThan(MAX_CACHED_SLICE_ROWS);
  });
});
