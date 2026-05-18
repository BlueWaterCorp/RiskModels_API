import { describe, expect, it } from "vitest";

import type { FundNavRow, FundPortfolioRow } from "@/lib/dal/funds-zarr-reader";

import {
  buildWaterfall,
  compoundCumulative,
  computeCumulativeSeries,
} from "@/lib/funds/snapshot-templates/cumulative-math";

const PORTFOLIO_ROW = (
  teo: string,
  m: number,
  s: number,
  sub: number,
  idio: number,
  gross: number,
): FundPortfolioRow => ({
  teo,
  portfolio_gross_return: gross,
  portfolio_market_return: m,
  portfolio_sector_return: s,
  portfolio_subsector_return: sub,
  portfolio_idiosyncratic_return: idio,
  identity_residual: null,
  weight_sum: 1,
  n_holdings_active: 100,
  effective_n: 50,
  top10_weight_sum: 0.3,
});

const NAV_ROW = (teo: string, ret: number): FundNavRow => ({
  teo,
  nav_close: 100,
  nav_return_monthly: ret,
});

describe("compoundCumulative", () => {
  it("compounds three +1% steps to (1.01)^3 - 1", () => {
    const out = compoundCumulative([0.01, 0.01, 0.01]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(0.01, 12);
    expect(out[1]).toBeCloseTo(0.0201, 12);
    expect(out[2]).toBeCloseTo(0.030301, 12);
  });

  it("handles a draw-down step correctly", () => {
    const out = compoundCumulative([0.10, -0.05]);
    expect(out[0]).toBeCloseTo(0.10, 12);
    expect(out[1]).toBeCloseTo(1.10 * 0.95 - 1, 12);
  });

  it("returns an empty array for empty input", () => {
    expect(compoundCumulative([])).toEqual([]);
  });
});

describe("computeCumulativeSeries", () => {
  it("derives layer paths matching the L3 identity (L3 = mkt + sec + sub)", () => {
    const rows = [
      PORTFOLIO_ROW("2026-01-31", 0.02, 0.005, 0.003, 0.001, 0.029),
      PORTFOLIO_ROW("2026-02-28", 0.01, -0.002, 0.001, 0.004, 0.013),
    ];
    const series = computeCumulativeSeries(rows, []);

    // L1 = market only
    expect(series.l1_market[0]).toBeCloseTo(0.02, 12);
    expect(series.l1_market[1]).toBeCloseTo(1.02 * 1.01 - 1, 12);

    // L2 = market + sector (per-month)
    expect(series.l2_sector[0]).toBeCloseTo(0.025, 12);
    expect(series.l2_sector[1]).toBeCloseTo(1.025 * 1.008 - 1, 12);

    // L3 = market + sector + subsector
    expect(series.l3_subsector[0]).toBeCloseTo(0.028, 12);
  });

  it("aligns NAV to the portfolio history by intersecting on teo", () => {
    const portfolio = [
      PORTFOLIO_ROW("2026-01-31", 0.01, 0, 0, 0, 0.01),
      PORTFOLIO_ROW("2026-02-28", 0.01, 0, 0, 0, 0.01),
      PORTFOLIO_ROW("2026-03-31", 0.01, 0, 0, 0, 0.01),
    ];
    // NAV missing the middle month — align should drop 2026-02-28 from both.
    const nav = [
      NAV_ROW("2026-01-31", 0.012),
      NAV_ROW("2026-03-31", 0.011),
    ];
    const series = computeCumulativeSeries(portfolio, nav);
    expect(series.teos).toEqual(["2026-01-31", "2026-03-31"]);
    expect(series.nav).toHaveLength(2);
    expect(series.gross).toHaveLength(2);
  });

  it("returns empty series object when portfolioHistory is empty", () => {
    const out = computeCumulativeSeries([], []);
    expect(out.teos).toEqual([]);
    expect(out.l1_market).toEqual([]);
    expect(out.gross).toEqual([]);
  });

  it("treats null layer returns as 0 (avoids NaN propagation)", () => {
    const rows = [
      {
        ...PORTFOLIO_ROW("2026-01-31", 0.02, 0, 0, 0, 0.02),
        portfolio_sector_return: null,
        portfolio_subsector_return: null,
      } as FundPortfolioRow,
    ];
    const series = computeCumulativeSeries(rows, []);
    expect(series.l2_sector[0]).toBeCloseTo(0.02, 12);
    expect(series.l3_subsector[0]).toBeCloseTo(0.02, 12);
  });
});

describe("buildWaterfall", () => {
  it("decomposes gross into market + sector_tilt + subsector_tilt + residual", () => {
    // Deterministic single-month example so endpoints equal step returns.
    // r_mkt=4%, r_sec=2%, r_sub=1%, r_idio=−1%, r_gross=6%
    const series = computeCumulativeSeries(
      [PORTFOLIO_ROW("2026-01-31", 0.04, 0.02, 0.01, -0.01, 0.06)],
      [],
    );
    const wf = buildWaterfall(series);
    expect(wf.l1_market).toBeCloseTo(0.04, 12);
    expect(wf.l2_sector).toBeCloseTo(0.02, 12);
    expect(wf.l3_subsector).toBeCloseTo(0.01, 12);
    expect(wf.residual).toBeCloseTo(0.06 - (0.04 + 0.02 + 0.01), 12);
    expect(wf.gross).toBeCloseTo(0.06, 12);

    // Identity: the four contributions sum to gross.
    expect(wf.l1_market + wf.l2_sector + wf.l3_subsector + wf.residual)
      .toBeCloseTo(wf.gross, 12);
  });

  it("returns nav: null when there's no NAV history", () => {
    const series = computeCumulativeSeries(
      [PORTFOLIO_ROW("2026-01-31", 0.01, 0, 0, 0, 0.01)],
      [],
    );
    expect(buildWaterfall(series).nav).toBeNull();
  });

  it("attaches realized-NAV endpoint when NAV history is present", () => {
    const series = computeCumulativeSeries(
      [PORTFOLIO_ROW("2026-01-31", 0.05, 0, 0, 0, 0.05)],
      [NAV_ROW("2026-01-31", 0.04)],
    );
    const wf = buildWaterfall(series);
    expect(wf.nav).toBeCloseTo(0.04, 12);
    expect(wf.gross).toBeCloseTo(0.05, 12);
  });

  it("returns zeros for empty input", () => {
    const wf = buildWaterfall(computeCumulativeSeries([], []));
    expect(wf).toEqual({
      l1_market: 0,
      l2_sector: 0,
      l3_subsector: 0,
      residual: 0,
      gross: 0,
      nav: null,
    });
  });
});
