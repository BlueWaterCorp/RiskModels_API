import { describe, expect, it } from "vitest";
import { getCache, setCache } from "@/lib/cache/redis";

// With Upstash unconfigured (test env), setCache/getCache use the in-process
// Map fallback. These pin the isolation semantics the funds-zarr cache layer
// relies on: the cache never holds or returns a caller-mutable reference, and
// values round-trip through JSON exactly like Upstash values do.
describe("memory-fallback cache isolation", () => {
  it("returns an equal but distinct object per getCache call", async () => {
    const stored = { teo: "2026-06-30", holdings: [{ bw_sym_id: "BW-X", weight: 0.5 }] };
    await setCache("test:iso:obj", stored, 60);

    const a = await getCache<typeof stored>("test:iso:obj");
    const b = await getCache<typeof stored>("test:iso:obj");
    expect(a).toEqual(stored);
    expect(a).not.toBe(stored);
    expect(a).not.toBe(b);

    // Mutating one caller's copy must not leak into the next read.
    a!.holdings.push({ bw_sym_id: "BW-MUTATED", weight: 1 });
    const c = await getCache<typeof stored>("test:iso:obj");
    expect(c!.holdings).toHaveLength(1);
  });

  it("does not reflect post-set mutation of the caller's object", async () => {
    const value = { rows: [1, 2, 3] };
    await setCache("test:iso:set", value, 60);
    value.rows.push(4);
    const hit = await getCache<typeof value>("test:iso:set");
    expect(hit!.rows).toEqual([1, 2, 3]);
  });

  it("matches Upstash serialization semantics (Map degrades to {})", async () => {
    await setCache("test:iso:map", { weights: new Map([["BW-X", 1]]) }, 60);
    const hit = await getCache<{ weights: unknown }>("test:iso:map");
    expect(hit!.weights).toEqual({});
  });
});
