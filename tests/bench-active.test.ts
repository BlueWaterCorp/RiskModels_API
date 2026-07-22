/**
 * Bench-active signals — pure-function units (bench_active_signals.md).
 *
 * Covers the bench registry parser (static / ff_own / cell_<slug> / all) and
 * the ff_own bench-weight construction: cap normalization, missing-cap
 * drop + renormalize + cap_coverage, and the never-synthesize rule
 * (all caps missing → null).
 */
import { describe, expect, it } from "vitest";

import {
  buildFfOwnBenchWeights,
  isCustomBenchInput,
  parseBenchRef,
  planBenchActiveFanOut,
} from "@/lib/dal/funds-zarr-reader";

describe("parseBenchRef", () => {
  it("resolves static aliases and bw_bench_ids (unchanged behavior)", () => {
    expect(parseBenchRef("SPY")).toEqual({ kind: "static", bwBenchId: "BW-BENCH-SPY" });
    expect(parseBenchRef("spy")).toEqual({ kind: "static", bwBenchId: "BW-BENCH-SPY" });
    expect(parseBenchRef("70/30")).toEqual({ kind: "static", bwBenchId: "BW-BENCH-EQ70-30" });
    expect(parseBenchRef("BW-BENCH-SPY")).toEqual({ kind: "static", bwBenchId: "BW-BENCH-SPY" });
  });

  it("resolves ff_own (case-insensitive)", () => {
    expect(parseBenchRef("ff_own")).toEqual({ kind: "ff_own" });
    expect(parseBenchRef("FF_OWN")).toEqual({ kind: "ff_own" });
  });

  it("resolves cell_<slug> for all 9-box slugs", () => {
    const ref = parseBenchRef("cell_large-growth");
    expect(ref).toEqual({
      kind: "cell",
      slug: "large-growth",
      cellName: "Large Growth",
      pathComponent: "Large_Growth",
    });
    for (const slug of [
      "large-value", "large-blend", "large-growth",
      "mid-value", "mid-blend", "mid-growth",
      "small-value", "small-blend", "small-growth",
    ]) {
      expect(parseBenchRef(`cell_${slug}`)?.kind).toBe("cell");
    }
  });

  it("rejects bad cell slugs and unknown benches", () => {
    expect(parseBenchRef("cell_notabox")).toBeNull();
    expect(parseBenchRef("cell_")).toBeNull();
    expect(parseBenchRef("NOPE")).toBeNull();
    expect(parseBenchRef("")).toBeNull();
  });

  it("resolves the all fan-out", () => {
    expect(parseBenchRef("all")).toEqual({ kind: "all" });
  });
});

describe("isCustomBenchInput", () => {
  it("classifies custom vs static bench params", () => {
    expect(isCustomBenchInput("ff_own")).toBe(true);
    expect(isCustomBenchInput("all")).toBe(true);
    expect(isCustomBenchInput("cell_large-growth")).toBe(true);
    expect(isCustomBenchInput("cell_notabox")).toBe(true); // still routes to the 400 check first
    expect(isCustomBenchInput("SPY")).toBe(false);
    expect(isCustomBenchInput("BW-BENCH-SPY")).toBe(false);
  });
});

describe("buildFfOwnBenchWeights", () => {
  it("normalizes caps over the held names (w_b(s) = cap(s) / Σ caps(held))", () => {
    const subject = new Map([
      ["BW-A", 0.5],
      ["BW-B", 0.5],
    ]);
    const caps = new Map<string, number | null>([
      ["BW-A", 100],
      ["BW-B", 300],
    ]);
    const out = buildFfOwnBenchWeights(subject, caps);
    expect(out).not.toBeNull();
    expect(out!.weights.get("BW-A")).toBeCloseTo(0.25, 12);
    expect(out!.weights.get("BW-B")).toBeCloseTo(0.75, 12);
    expect(out!.cap_coverage).toBeCloseTo(1, 12);
    expect(out!.n_cap_dropped).toBe(0);
  });

  it("drops missing/invalid caps, renormalizes, and counts coverage", () => {
    const subject = new Map([
      ["BW-A", 0.5],
      ["BW-B", 0.3],
      ["BW-C", 0.2], // no cap → dropped
    ]);
    const caps = new Map<string, number | null>([
      ["BW-A", 100],
      ["BW-B", 100],
      ["BW-C", null],
    ]);
    const out = buildFfOwnBenchWeights(subject, caps)!;
    expect(out.weights.size).toBe(2);
    expect(out.weights.get("BW-A")).toBeCloseTo(0.5, 12);
    expect(out.weights.get("BW-B")).toBeCloseTo(0.5, 12);
    // coverage = share of subject weight with a valid cap = 0.8
    expect(out.cap_coverage).toBeCloseTo(0.8, 12);
    expect(out.n_cap_dropped).toBe(1);
  });

  it("drops zero / negative / non-finite caps", () => {
    const subject = new Map([
      ["BW-A", 0.4],
      ["BW-B", 0.3],
      ["BW-C", 0.3],
    ]);
    const caps = new Map<string, number | null>([
      ["BW-A", 0],
      ["BW-B", -5],
      ["BW-C", 10],
    ]);
    const out = buildFfOwnBenchWeights(subject, caps)!;
    expect([...out.weights.keys()]).toEqual(["BW-C"]);
    expect(out.weights.get("BW-C")).toBeCloseTo(1, 12);
    expect(out.cap_coverage).toBeCloseTo(0.3, 12);
    expect(out.n_cap_dropped).toBe(2);
  });

  it("returns null when no held symbol has a valid cap (never synthesizes)", () => {
    const subject = new Map([
      ["BW-A", 0.6],
      ["BW-B", 0.4],
    ]);
    expect(
      buildFfOwnBenchWeights(subject, new Map([["BW-A", null]])),
    ).toBeNull();
    expect(buildFfOwnBenchWeights(new Map(), new Map())).toBeNull();
  });
});


describe("planBenchActiveFanOut (readiness gate)", () => {
  it("omits development benches with reason under_development", () => {
    // Real registry: SPY is development (hollow trailing teos), ff_own +
    // large-blend are live.
    const plan = planBenchActiveFanOut("large-blend");
    expect(plan.live.map((i) => i.label)).toEqual(["ff_own", "cell_large-blend"]);
    expect(plan.omitted).toEqual([{ benchmark: "SPY", reason: "under_development" }]);
  });

  it("omits mid cells (Mid-Cap naming mismatch) while keeping ff_own", () => {
    const plan = planBenchActiveFanOut("mid-blend");
    expect(plan.live.map((i) => i.label)).toEqual(["ff_own"]);
    expect(plan.omitted).toEqual([
      { benchmark: "SPY", reason: "under_development" },
      { benchmark: "cell_mid-blend", reason: "under_development" },
    ]);
  });

  it("omits cell_* entirely when the subject has no declared style cell", () => {
    const plan = planBenchActiveFanOut(null);
    expect(plan.live.map((i) => i.label)).toEqual(["ff_own"]);
    expect(plan.omitted).toContainEqual({
      benchmark: "cell_*",
      reason: "no declared style cell for this subject",
    });
    expect(plan.omitted).toContainEqual({ benchmark: "SPY", reason: "under_development" });
  });
});
