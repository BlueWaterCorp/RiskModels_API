/**
 * Benchmark readiness registry (lib/benchmark-registry.ts).
 *
 * Fail-closed default: any bench id NOT in the registry is `development`
 * (blocked until explicitly promoted after a GCS history audit). Known
 * statuses pinned from the 2026-07-20 GCS audit (see PR #270).
 */
import { describe, expect, it } from "vitest";

import {
  BENCHMARK_READINESS_REGISTRY,
  getBenchReadiness,
  isBenchLive,
} from "@/lib/benchmark-registry";

describe("getBenchReadiness", () => {
  it("defaults to development for ids absent from the registry (fail-closed)", () => {
    for (const id of ["BW-BENCH-NEW-EXPERIMENT", "ff_custom_v2", "cell_ unknown", ""]) {
      const r = getBenchReadiness(id);
      expect(r.status).toBe("development");
      expect(r.notes).toMatch(/fail-closed/);
      expect(isBenchLive(id)).toBe(false);
    }
  });

  it("marks the hollow / shallow static benches development", () => {
    expect(getBenchReadiness("BW-BENCH-SPY").status).toBe("development");
    expect(getBenchReadiness("BW-BENCH-SPY").notes).toMatch(/trailing teos hollow/);
    expect(getBenchReadiness("BW-BENCH-EQ70-30").status).toBe("development");
    expect(getBenchReadiness("BW-BENCH-EQ-LARGE-VALUE-60-40").status).toBe("development");
    expect(getBenchReadiness("BW-BENCH-EQ-LARGE-VALUE-60-40").min_teos).toBeGreaterThan(1);
  });

  it("marks ff_own + the verified cells live, mid cells development", () => {
    expect(isBenchLive("ff_own")).toBe(true);
    for (const slug of [
      "large-value", "large-blend", "large-growth",
      "small-value", "small-blend", "small-growth",
    ]) {
      expect(isBenchLive(`cell_${slug}`)).toBe(true);
    }
    for (const slug of ["mid-value", "mid-blend", "mid-growth"]) {
      expect(isBenchLive(`cell_${slug}`)).toBe(false);
      expect(getBenchReadiness(`cell_${slug}`).notes).toMatch(/Mid-Cap/);
    }
  });

  it("registry entries are uniquely keyed", () => {
    const ids = BENCHMARK_READINESS_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
