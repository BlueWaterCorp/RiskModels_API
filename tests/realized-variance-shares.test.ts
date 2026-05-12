import { describe, expect, it } from "vitest";
import { realizedVarianceShares } from "@/lib/portfolio/canonical-snapshot";

/** Deterministic pseudo-random in [-0.02, 0.02] from a small LCG. */
function noise(seed: number, n: number): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push((s / 0xffffffff - 0.5) * 0.04);
  }
  return out;
}

describe("realizedVarianceShares", () => {
  it("returns null below the minimum observation count", () => {
    const a = Array(30).fill(0).map((_, i) => i * 1e-4);
    expect(
      realizedVarianceShares({ gross: a, market: a, sector: a, subsector: a, residual: a }),
    ).toBeNull();
  });

  it("returns null for a degenerate (constant) portfolio return strip", () => {
    const c = Array(120).fill(0.001);
    const z = Array(120).fill(0);
    // gross = market + ... = constant ⇒ var(gross) ≈ 0
    expect(
      realizedVarianceShares({ gross: c, market: c, sector: z, subsector: z, residual: z }),
    ).toBeNull();
  });

  it("shares sum to ~1 and gross = sum of strips is respected", () => {
    const n = 200;
    const market = noise(1, n);
    const sector = noise(2, n).map((v) => v * 0.5);
    const subsector = noise(3, n).map((v) => v * 0.3);
    const residual = noise(4, n).map((v) => v * 0.4);
    const gross = market.map((m, i) => m + sector[i] + subsector[i] + residual[i]);
    const r = realizedVarianceShares({ gross, market, sector, subsector, residual });
    expect(r).not.toBeNull();
    if (!r) return;
    const sum = r.market + r.sector + r.subsector + r.residual;
    expect(sum).toBeCloseTo(1, 6);
    for (const v of [r.market, r.sector, r.subsector, r.residual]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Market has the largest amplitude here, so the largest share.
    expect(r.market).toBeGreaterThan(r.sector);
    expect(r.market).toBeGreaterThan(r.subsector);
    expect(r.market).toBeGreaterThan(r.residual);
  });

  it("residual share reflects realized cross-holding correlation, not a count formula", () => {
    // Two-holding portfolio, equal weight. If residuals were assumed uncorrelated
    // a count formula would put residual share at ~1/2 of the single-name level;
    // here we make the two residual strips identical (perfectly correlated), so
    // the realized residual variance does NOT diversify away — it stays large.
    const n = 250;
    const market = noise(10, n).map((v) => v * 0.2);
    const resCommon = noise(11, n); // both holdings share this residual path
    // portfolio residual strip = 0.5*resCommon + 0.5*resCommon = resCommon
    const residual = resCommon;
    const sector = Array(n).fill(0);
    const subsector = Array(n).fill(0);
    const gross = market.map((m, i) => m + residual[i]);
    const r = realizedVarianceShares({ gross, market, sector, subsector, residual });
    expect(r).not.toBeNull();
    if (!r) return;
    // resCommon has the larger amplitude → residual dominates; nowhere near 1/2-of-anything-small.
    expect(r.residual).toBeGreaterThan(0.6);
    expect(r.sector).toBe(0);
    expect(r.subsector).toBe(0);
  });

  it("clamps a negative (hedging) layer to zero and renormalizes", () => {
    const n = 150;
    const market = noise(20, n);
    // residual strip moves *against* the rest ⇒ negative cov with gross.
    const residual = market.map((v) => -0.6 * v);
    const sector = Array(n).fill(0);
    const subsector = Array(n).fill(0);
    const gross = market.map((m, i) => m + sector[i] + subsector[i] + residual[i]);
    const r = realizedVarianceShares({ gross, market, sector, subsector, residual });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.residual).toBe(0);
    expect(r.market + r.sector + r.subsector + r.residual).toBeCloseTo(1, 6);
  });
});
