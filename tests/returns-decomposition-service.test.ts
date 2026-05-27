import { describe, expect, it } from "vitest";

import { toReturnsDecompositionPublicBody } from "@/lib/risk/returns-decomposition-service";

describe("toReturnsDecompositionPublicBody", () => {
  it("maps wire keys to semantic REST field names", () => {
    const body = toReturnsDecompositionPublicBody({
      ticker: "AAPL",
      dates: ["2026-01-02"],
      returns_gross: [0.01],
      l1_fr: [0.008],
      l2_fr: [0.002],
      l3_fr: [0.001],
      l1_cfr: [0.008],
      l2_cfr: [0.01],
      l3_cfr: [0.011],
      l1_rr: [0.002],
      l2_rr: [0.0015],
      l3_rr: [0.001],
      market_factor_etf: "SPY",
      universe: "US_EQUITY",
      data_source: "zarr",
    });

    expect(body.gross_return).toEqual([0.01]);
    expect(body.l1_factor_return).toEqual([0.008]);
    expect(body.l3_residual_return).toEqual([0.001]);
    expect(body.lstar).toBeUndefined();
  });

  it("includes optional Lstar arrays when present on the result", () => {
    const body = toReturnsDecompositionPublicBody({
      ticker: "NVDA",
      dates: ["2026-01-02"],
      returns_gross: [0.02],
      l1_fr: [0.01],
      l2_fr: [0.005],
      l3_fr: [0.003],
      l1_cfr: [0.01],
      l2_cfr: [0.015],
      l3_cfr: [0.018],
      l1_rr: [0.01],
      l2_rr: [0.005],
      l3_rr: [0.002],
      lstar: ["L3"],
      lstar_residual_return: [0.002],
      threshold_used: 0.01,
      market_factor_etf: "SPY",
      universe: "US_EQUITY",
      data_source: "zarr",
    });

    expect(body.lstar).toEqual(["L3"]);
    expect(body.lstar_residual_return).toEqual([0.002]);
    expect(body.threshold_used).toBe(0.01);
  });
});
