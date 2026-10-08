import { beforeEach, describe, expect, it, vi } from "vitest";

const objects: Array<{ name: string; id: string | null; created_at?: string }> = [];
const calls: Array<{ bucket: string; prefix: string; opts: Record<string, unknown> }> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string, opts: { limit: number; offset: number }) => {
          calls.push({ bucket, prefix, opts });
          const sorted = [...objects].sort((a, b) => a.name.localeCompare(b.name));
          // A server that returns at most 30 rows per page whatever the limit.
          return { data: sorted.slice(opts.offset, opts.offset + Math.min(opts.limit, 30)), error: null };
        },
      }),
    },
  }),
}));

import { exposureHistoryBuildTag, inspectExposureHistoryFolder } from "@/lib/supabase/storage";

const K = "a".repeat(32);
const f = (name: string, at = "2026-10-08T00:00:00Z") => ({ name, id: `id-${name}`, created_at: at });

describe("inspectExposureHistoryFolder", () => {
  beforeEach(() => {
    objects.length = 0;
    calls.length = 0;
  });

  it("reads every page in name order and finds the newest complete pair and the condemned marker", async () => {
    objects.push(
      { name: "hits", id: null },
      f("condemned", "2026-10-03T00:00:00Z"),
      f("names.1111111111111111.parquet", "2026-10-01T00:00:00Z"),
      f("cov.1111111111111111.parquet", "2026-10-01T00:00:00Z"),
      f("names.2222222222222222.parquet", "2026-10-05T00:00:00Z"),
      f("cov.2222222222222222.parquet", "2026-10-05T00:00:00Z"),
      f("names.3333333333333333.parquet", "2026-10-07T00:00:00Z"), // partial: no cov
      ...Array.from({ length: 60 }, (_, i) => f(`junk${String(i).padStart(2, "0")}`)),
    );
    const s = await inspectExposureHistoryFolder(K);
    expect(s).toEqual({
      error: false,
      condemned: true,
      pair: { names: `${K}/names.2222222222222222.parquet`, cov: `${K}/cov.2222222222222222.parquet` },
    });
    expect(calls.every((c) => c.bucket === "exposure-history" && c.prefix === K)).toBe(true);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls[0].opts.sortBy).toEqual({ column: "name", order: "asc" });
  });

  it("does not serve a pair older than the condemned marker", async () => {
    objects.push(f("condemned", "2026-10-09T00:00:00Z"), f("names.parquet"), f("cov.parquet"));
    expect(await inspectExposureHistoryFolder(K)).toEqual({ error: false, condemned: true, pair: null });
  });

  it("fails closed when the listing does not finish", async () => {
    objects.push(...Array.from({ length: 4000 }, (_, i) => f(`z${String(i).padStart(4, "0")}`)), f("names.parquet"), f("cov.parquet"));
    expect((await inspectExposureHistoryFolder(K)).error).toBe(true);
  });

  it("serves a legacy names.parquet / cov.parquet pair", async () => {
    objects.push(f("cov.parquet"), f(`hit.${exposureHistoryBuildTag("x")}`), f("names.parquet"));
    expect((await inspectExposureHistoryFolder(K)).pair).toEqual({ names: `${K}/names.parquet`, cov: `${K}/cov.parquet` });
  });

  it("build tag trims", () => {
    expect(exposureHistoryBuildTag(" 2026-10-08T00:00:00Z ")).toBe(exposureHistoryBuildTag("2026-10-08T00:00:00Z"));
    expect(exposureHistoryBuildTag(null)).toBe(exposureHistoryBuildTag("  "));
  });
});
