/**
 * Test parity with `~/BW_Code/ERM3/tests/test_hedge_recommendation.py`.
 *
 * Each case below mirrors a Python test. If outputs diverge between the two
 * implementations, the Python is the source of truth (per the spec at
 * docs/plans/hedge-recommendation-ts-port.md) — update this file to match,
 * not the other way around.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ER_HAIRCUT,
  SEGMENT_LEVERAGE_CAPS,
  hedgeGrossFromHrs,
  recommendHedgeLevel,
} from "@/lib/dal/hedge-recommendation";

describe("recommendHedgeLevel — realistic scenarios from the diverse-ticker basket", () => {
  it("AAPL today: Lstar=L3, downgraded to L1 by leverage + ER floor", () => {
    // AAPL today: L3 hedge gross 2.44 over 2.0 cap, L2 sector ER 0.7% raw →
    // 0.49% haircut, fails 1% floor. L3 subsec ER 2.0% raw → 1.4% haircut passes.
    const rec = recommendHedgeLevel({
      lstar: "L3",
      l1HedgeGross: 0.88,
      l2HedgeGross: 1.40,
      l3HedgeGross: 2.44,
      l2SectorEr: 0.007,
      l3SubsectorEr: 0.020,
      userSegment: "family_office",
    });
    expect(rec).toBe("L1");
  });

  it("high-signal small-cap keeps L3 under LS cap", () => {
    const rec = recommendHedgeLevel({
      lstar: "L3",
      l1HedgeGross: 1.45,
      l2HedgeGross: 1.80,
      l3HedgeGross: 2.15,
      l2SectorEr: 0.06,
      l3SubsectorEr: 0.11,
      userSegment: "ls_equity",
    });
    expect(rec).toBe("L3");
  });

  it("defensive utility stays L1", () => {
    const rec = recommendHedgeLevel({
      lstar: "L1",
      l1HedgeGross: 0.45,
      l2HedgeGross: 0.55,
      l3HedgeGross: 0.60,
      l2SectorEr: 0.005,
      l3SubsectorEr: 0.002,
      userSegment: "retail",
    });
    expect(rec).toBe("L1");
  });

  it("regional bank keeps L2", () => {
    const rec = recommendHedgeLevel({
      lstar: "L2",
      l1HedgeGross: 0.65,
      l2HedgeGross: 1.35,
      l3HedgeGross: 1.50,
      l2SectorEr: 0.045,
      l3SubsectorEr: 0.0,
      userSegment: "family_office",
    });
    expect(rec).toBe("L2");
  });

  it("high-beta semi downgrades by user segment", () => {
    const common = {
      lstar: "L3" as const,
      l1HedgeGross: 1.65,
      l2HedgeGross: 2.20,
      l3HedgeGross: 3.10,
      l2SectorEr: 0.04,           // 2.8% haircut
      l3SubsectorEr: 0.068,       // 4.76% haircut
    };
    // retail (cap 1.5): L3 fails leverage → L2; L2=2.20>1.5 → L1
    expect(recommendHedgeLevel({ ...common, userSegment: "retail" })).toBe("L1");
    // family_office (cap 2.0): L3 fails → L2; L2=2.20>2.0 → L1
    expect(recommendHedgeLevel({ ...common, userSegment: "family_office" })).toBe("L1");
    // ls_equity (cap 3.0): L3=3.10>3.0 → L2; L2=2.20<3.0 + ER passes → keep L2
    expect(recommendHedgeLevel({ ...common, userSegment: "ls_equity" })).toBe("L2");
    // stat_arb (cap 5.0): L3 fits → keep L3
    expect(recommendHedgeLevel({ ...common, userSegment: "stat_arb" })).toBe("L3");
  });
});

describe("recommendHedgeLevel — edge cases", () => {
  it("null / empty / unknown Lstar falls back to L1", () => {
    for (const v of [null, "", "L0", "L4", "unknown"]) {
      const rec = recommendHedgeLevel({
        // Cast through unknown to satisfy the stricter LStarOrNone union for invalid inputs.
        lstar: v as unknown as null,
        l1HedgeGross: 0.0,
        l2HedgeGross: 0.0,
        l3HedgeGross: 0.0,
        l2SectorEr: 0.10,
        l3SubsectorEr: 0.10,
      });
      expect(rec, `lstar=${JSON.stringify(v)} should fall back to L1`).toBe("L1");
    }
  });

  it("explicit leverageCap overrides segment default", () => {
    const common = {
      lstar: "L3" as const,
      l1HedgeGross: 1.0,
      l2HedgeGross: 1.8,
      l3HedgeGross: 2.5,
      l2SectorEr: 0.03,
      l3SubsectorEr: 0.04,
    };
    // family_office cap 2.0: L3 fails → L2 passes (1.8 < 2.0)
    expect(recommendHedgeLevel({ ...common, userSegment: "family_office" })).toBe("L2");
    // Override cap=2.7: L3 fits
    expect(recommendHedgeLevel({ ...common, leverageCap: 2.7 })).toBe("L3");
    // Override cap=1.0: both L3 and L2 fail → L1
    expect(recommendHedgeLevel({ ...common, leverageCap: 1.0 })).toBe("L1");
  });

  it("erHaircut=0 collapses every gate (pessimist) → falls to L1", () => {
    const rec = recommendHedgeLevel({
      lstar: "L3",
      l1HedgeGross: 0.1,
      l2HedgeGross: 0.1,
      l3HedgeGross: 0.1,           // well under any cap
      l2SectorEr: 1.0,              // arbitrarily large
      l3SubsectorEr: 1.0,
      erHaircut: 0.0,
      userSegment: "stat_arb",      // leverage never binds
    });
    expect(rec).toBe("L1");
  });
});

describe("constants pinned for cross-implementation parity", () => {
  it("DEFAULT_ER_HAIRCUT equals 0.7 (Python parity)", () => {
    expect(DEFAULT_ER_HAIRCUT).toBe(0.7);
  });

  it("SEGMENT_LEVERAGE_CAPS is monotonically increasing retail → family → ls → stat", () => {
    const caps = [
      SEGMENT_LEVERAGE_CAPS.retail,
      SEGMENT_LEVERAGE_CAPS.family_office,
      SEGMENT_LEVERAGE_CAPS.ls_equity,
      SEGMENT_LEVERAGE_CAPS.stat_arb,
    ];
    const sorted = [...caps].sort((a, b) => a - b);
    expect(caps).toEqual(sorted);
  });
});

describe("hedgeGrossFromHrs", () => {
  it("sums absolute values", () => {
    expect(hedgeGrossFromHrs(0.5, -0.3, 0.2)).toBeCloseTo(1.0, 6);
  });

  it("is NaN-safe (NaN inputs are skipped)", () => {
    expect(hedgeGrossFromHrs(0.5, Number.NaN, 0.2)).toBeCloseTo(0.7, 6);
  });

  it("skips null/undefined", () => {
    expect(hedgeGrossFromHrs(0.5, null, 0.2, undefined)).toBeCloseTo(0.7, 6);
  });

  it("returns 0 with no inputs", () => {
    expect(hedgeGrossFromHrs()).toBe(0);
  });

  it("reproduces AAPL L1/L2/L3 hedge gross from the live zarr", () => {
    // Values from `xr.open_zarr(ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr)`
    // at AAPL's latest teo (2026-05-18). Matches the parallel Python case
    // `test_hedge_gross_l1_l2_l3_for_aapl`.
    const l1 = hedgeGrossFromHrs(-0.862);
    const l2 = hedgeGrossFromHrs(-1.396, 0.357);
    const l3 = hedgeGrossFromHrs(-2.002, -0.026, 0.410);
    expect(l1).toBeCloseTo(0.862, 3);
    expect(l2).toBeCloseTo(1.753, 3);
    expect(l3).toBeCloseTo(2.438, 3);
  });
});
