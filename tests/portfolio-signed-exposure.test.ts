import { describe, expect, it } from "vitest";
import {
  HEDGE_ADDED_VARIANCE_WARN_THRESHOLD,
  computeSignedExposure,
  type EtfCovariance,
  type StockInput,
} from "@/lib/portfolio/signed-exposure";
import { buildEtfCovariance } from "@/lib/portfolio/signed-exposure-data";

// Daily covariance of SPY, XLK, SMH (constructed, PSD).
const COV: EtfCovariance = {
  etfs: ["SPY", "XLK", "SMH"],
  S: [
    [1.0e-4, 1.1e-4, 1.3e-4],
    [1.1e-4, 1.6e-4, 1.8e-4],
    [1.3e-4, 1.8e-4, 3.0e-4],
  ],
  start: "2025-10-01",
  end: "2026-10-07",
  requested_n: 252,
  effective_n: 252,
};

function stock(
  symbol: string,
  value: number,
  m: Record<string, number | null | undefined>,
  sector = "XLK",
  sub: string | null = "SMH",
): StockInput {
  return { symbol, tickers: [symbol], value, sector_etf: sector, subsector_etf: sub, metrics: m };
}

const NVDA = {
  l1_mkt_beta: 1.8, l1_mkt_hr: -1.8,
  l2_mkt_hr: -0.9, l2_sec_hr: -0.8,
  l3_mkt_hr: -0.5, l3_sec_hr: -0.4, l3_sub_hr: -0.7,
  stock_var: 9e-4, l3_res_er: 0.4, lstar_level: 3,
};
const AMD = {
  l1_mkt_beta: 2.0, l1_mkt_hr: -2.0,
  l2_mkt_hr: -1.0, l2_sec_hr: -0.9,
  l3_mkt_hr: -0.6, l3_sec_hr: -0.3, l3_sub_hr: -0.9,
  stock_var: 1.2e-3, l3_res_er: 0.5, lstar_level: 3,
};

function quad(a: number[], S: number[][], b: number[]) {
  return a.reduce((acc, ai, i) => acc + ai * S[i]!.reduce((r, sij, j) => r + sij * b[j]!, 0), 0);
}

describe("computeSignedExposure", () => {
  const book = [stock("NVDA", 100_000, NVDA), stock("AMD", -60_000, AMD)];
  const out = computeSignedExposure({ stocks: book, directEtfs: [], inputGrossUsd: 160_000, cov: COV });

  it("sums beta-dollars with signs, without normalising", () => {
    expect(out.beta.stock_beta_usd).toBeCloseTo(100_000 * 1.8 - 60_000 * 2.0, 2);
    expect(out.beta.by_sector_usd.XLK).toBeCloseTo(60_000, 2);
  });

  it("hedge trade per ETF is Σ value × hr", () => {
    const l3 = out.hedges.l3 as { stock_hedge_trade_usd: Record<string, number> };
    expect(l3.stock_hedge_trade_usd.SPY).toBeCloseTo(100_000 * -0.5 - 60_000 * -0.6, 2);
    expect(l3.stock_hedge_trade_usd.XLK).toBeCloseTo(100_000 * -0.4 - 60_000 * -0.3, 2);
    expect(l3.stock_hedge_trade_usd.SMH).toBeCloseTo(100_000 * -0.7 - 60_000 * -0.9, 2);
  });

  it("systematic variance is xᵀΣx with x = -H, and layer contributions sum to it", () => {
    const x = [
      -(100_000 * -0.5 - 60_000 * -0.6),
      -(100_000 * -0.4 - 60_000 * -0.3),
      -(100_000 * -0.7 - 60_000 * -0.9),
    ];
    const risk = out.risk as any;
    expect(risk.systematic.daily_variance_usd2).toBeCloseTo(quad(x, COV.S, x), 6);
    const sum = Object.values(risk.systematic.layer_contributions as Record<string, { daily_variance_usd2: number }>)
      .reduce((a, c) => a + c.daily_variance_usd2, 0);
    expect(sum).toBeCloseTo(risk.systematic.daily_variance_usd2, 6);
  });

  it("residual is the diagonal Σ v²·stock_var·lK_res_er", () => {
    const expected = 100_000 ** 2 * 9e-4 * 0.4 + 60_000 ** 2 * 1.2e-3 * 0.5;
    const risk = out.risk as any;
    expect(risk.residual.daily_variance_usd2).toBeCloseTo(expected, 4);
    expect(risk.residual.method).toBe("residual_variance_diagonal_approximation");
    expect(risk.residual.level_basis).toBe("lstar");
  });

  it("annualises volatility with √252, not ×252", () => {
    const t = (out.risk as any).total;
    expect(t.annual_vol_usd).toBeCloseTo(t.daily_vol_usd * Math.sqrt(252), 0);
  });

  it("a long and an equal short of the same name net to no systematic risk", () => {
    const flat = computeSignedExposure({
      stocks: [stock("A", 50_000, NVDA), stock("B", -50_000, NVDA)],
      directEtfs: [],
      inputGrossUsd: 100_000,
      cov: COV,
    });
    const risk = flat.risk as any;
    expect(flat.beta.stock_beta_usd).toBeCloseTo(0, 6);
    expect(risk.systematic.daily_variance_usd2).toBeCloseTo(0, 6);
    expect(risk.systematic.layer_contributions.market.share_of_systematic).toBeNull();
    // Residuals of two different names do not cancel.
    expect(risk.residual.daily_variance_usd2).toBeGreaterThan(0);
  });

  it("treats ETFs held in the book as exposure to themselves, kept apart from the stock hedge", () => {
    const withSpy = computeSignedExposure({
      stocks: [stock("NVDA", 100_000, NVDA)],
      directEtfs: [{ ticker: "SPY", value: -40_000 }],
      inputGrossUsd: 140_000,
      cov: COV,
    });
    const l1 = withSpy.hedges.l1 as any;
    expect(l1.stock_hedge_trade_usd.SPY).toBeCloseTo(-180_000, 2);
    expect(l1.direct_etf_exposure_usd.SPY).toBeCloseTo(-40_000, 2);
    // T = H - d: the SPY short already held covers 40k of the 180k hedge.
    expect(l1.total_neutralizing_trade_usd.SPY).toBeCloseTo(-140_000, 2);
    expect(withSpy.beta.direct_etf_beta_usd).toBeCloseTo(-40_000, 2);
    expect(withSpy.beta.total_beta_usd).toBeCloseTo(180_000 - 40_000, 2);
    expect((withSpy.risk as any).systematic.layer_contributions.direct_etf.daily_variance_usd2).toBeLessThan(0);
  });

  it("subsector falls back to the sector ETF and both legs land on it", () => {
    const fb = computeSignedExposure({
      stocks: [stock("X", 10_000, NVDA, "XLK", null)],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    const l3 = fb.hedges.l3 as any;
    expect(l3.stock_hedge_trade_usd.XLK).toBeCloseTo(10_000 * (-0.4 - 0.7), 2);
    expect(l3.stock_hedge_trade_usd.SMH).toBeUndefined();
  });

  it("reports coverage per calculation against submitted gross, never renormalising", () => {
    const partial = computeSignedExposure({
      stocks: [stock("NVDA", 100_000, NVDA), stock("NOHR", 50_000, { l1_mkt_beta: 1, stock_var: 4e-4, l3_res_er: 0.6 })],
      directEtfs: [{ ticker: "COPX", value: 50_000 }],
      inputGrossUsd: 250_000,
      cov: COV,
    });
    const c = partial.coverage.by_calculation;
    expect(c.hedge_l3).toBeCloseTo(0.4, 4);
    // NOHR has no hedge legs, so it has no level and its residual is not used either.
    expect(c.residual).toBeCloseTo(0.4, 4);
    expect(c.systematic).toBeCloseTo(0.4, 4);
    expect(partial.coverage.etfs_without_covariance).toEqual(["COPX"]);
  });

  it("uses a residual share above 1 as is and reports that the hedge added variance", () => {
    // BRK.B-like: the market leg removed less than nothing, so l1_res_er = 1.052.
    const r = computeSignedExposure({
      stocks: [stock("BRK", 10_000, { ...NVDA, l1_res_er: 1.052, lstar_level: 1 })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    const risk = r.risk as any;
    expect(r.coverage.residual_flagged).toEqual([]);
    expect(risk.residual.daily_variance_usd2).toBeCloseTo(10_000 ** 2 * 9e-4 * 1.052, 4);
    expect(risk.residual.hedge_added_variance).toEqual([{ ticker: "BRK", level: "l1", residual_share: 1.052 }]);
    expect(r.coverage.by_calculation.residual).toBe(1);
    expect(r.warnings.map((w) => w.code)).toEqual(["hedge_added_variance"]);
  });

  it("warns on an extreme residual share but still uses it", () => {
    const r = computeSignedExposure({
      stocks: [stock("ODD", 10_000, { ...NVDA, l3_res_er: 2.5 })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect((r.risk as any).residual.daily_variance_usd2).toBeCloseTo(10_000 ** 2 * 9e-4 * 2.5, 4);
    expect(r.warnings.map((w) => w.code)).toEqual(["hedge_added_variance", "residual_share_extreme"]);
  });

  it("floors a negative residual share at 0 so it never subtracts variance", () => {
    const r = computeSignedExposure({
      stocks: [stock("NEG", 10_000, { ...NVDA, l3_res_er: -0.03 }), stock("NVDA", 10_000, NVDA)],
      directEtfs: [],
      inputGrossUsd: 20_000,
      cov: COV,
    });
    expect((r.risk as any).residual.daily_variance_usd2).toBeCloseTo(10_000 ** 2 * 9e-4 * 0.4, 4);
    expect(r.warnings.find((w) => w.code === "residual_share_floored")?.tickers).toEqual(["NEG"]);
  });

  it("still excludes a name with negative stock_var from the residual", () => {
    const r = computeSignedExposure({
      stocks: [stock("BAD", 10_000, { ...NVDA, stock_var: -1e-4 })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect(r.coverage.residual_flagged).toEqual([{ ticker: "BAD", reason: "negative stock_var" }]);
    expect((r.risk as any).residual.daily_variance_usd2).toBe(0);
  });

  it("reconciliation is ~0 when the covariance reproduces the model's own split", () => {
    const own = [0.5, 0.4, 0.7]; // -hr for NVDA's L3 legs
    const sys = quad(own, COV.S, own);
    const consistent = { ...NVDA, stock_var: sys / (1 - 0.4) };
    const r = computeSignedExposure({
      stocks: [stock("NVDA", 1, consistent)],
      directEtfs: [],
      inputGrossUsd: 1,
      cov: COV,
    });
    expect((r.risk as any).reconciliation.median_relative_error).toBeCloseTo(0, 10);
  });
});

describe("buildEtfCovariance", () => {
  const dates = Array.from({ length: 80 }, (_, i) => `2026-0${i < 40 ? 6 : 7}-${String((i % 40) + 1).padStart(2, "0")}`);
  const series = (f: (i: number) => number) => new Map(dates.map((d, i) => [d, f(i)]));

  it("uses one aligned panel ending on the snapshot date, with N-1 sample covariance", () => {
    const spy = series((i) => Math.sin(i) / 100);
    const xlk = series((i) => (1.2 * Math.sin(i)) / 100 + Math.cos(i) / 500);
    const { cov } = buildEtfCovariance(new Map([["SPY", spy], ["XLK", xlk]]), dates[79]!, 70);
    expect(cov!.etfs).toEqual(["SPY", "XLK"]);
    expect(cov!.effective_n).toBe(70);
    expect(cov!.end).toBe(dates[79]);
    const a = dates.slice(-70).map((d) => spy.get(d)!);
    const ma = a.reduce((x, y) => x + y, 0) / 70;
    const v = a.reduce((x, y) => x + (y - ma) ** 2, 0) / 69;
    expect(cov!.S[0]![0]).toBeCloseTo(v, 14);
    expect(cov!.S[0]![1]).toBe(cov!.S[1]![0]);
  });

  it("never uses a date after the snapshot", () => {
    const spy = series((i) => i / 1000);
    const { cov } = buildEtfCovariance(new Map([["SPY", spy]]), dates[69]!, 70);
    expect(cov!.end).toBe(dates[69]);
  });

  it("excludes an ETF with a missing day rather than filling it", () => {
    const spy = series((i) => Math.sin(i) / 100);
    const gappy = series((i) => Math.cos(i) / 100);
    gappy.delete(dates[75]!);
    const { cov, excluded } = buildEtfCovariance(new Map([["SPY", spy], ["NEW", gappy]]), dates[79]!, 70);
    expect(cov!.etfs).toEqual(["SPY"]);
    expect(excluded).toEqual(["NEW"]);
  });

  it("returns no covariance with too few observations", () => {
    const spy = series((i) => i / 1000);
    const { cov } = buildEtfCovariance(new Map([["SPY", spy]]), dates[30]!, 252);
    expect(cov).toBeNull();
  });
});

describe("L* basis (default)", () => {
  const withLevels = (lstar: number | null) => ({ ...NVDA, l1_res_er: 0.6, l2_res_er: 0.5, lstar_level: lstar });

  it("hedges and measures each name at its own L* level", () => {
    const out = computeSignedExposure({
      stocks: [stock("A", 100_000, withLevels(1)), stock("B", -50_000, withLevels(3))],
      directEtfs: [],
      inputGrossUsd: 150_000,
      cov: COV,
    });
    const lstar = out.hedges.lstar as any;
    // A at L1: SPY only (100k × -1.8). B at L3: three legs.
    expect(lstar.stock_hedge_trade_usd.SPY).toBeCloseTo(100_000 * -1.8 + -50_000 * -0.5, 2);
    expect(lstar.stock_hedge_trade_usd.XLK).toBeCloseTo(-50_000 * -0.4, 2);
    expect(lstar.names_by_level).toEqual({ l1: 1, l2: 0, l3: 1 });
    const risk = out.risk as any;
    expect(risk.basis).toBe("lstar");
    // Residual uses each name's own level: A at l1_res_er, B at l3_res_er.
    expect(risk.residual.daily_variance_usd2).toBeCloseTo(100_000 ** 2 * 9e-4 * 0.6 + 50_000 ** 2 * 9e-4 * 0.4, 4);
  });

  it("an explicit level overrides L* for every name", () => {
    const out = computeSignedExposure({
      stocks: [stock("A", 100_000, withLevels(1))],
      directEtfs: [],
      inputGrossUsd: 100_000,
      cov: COV,
      basis: "l3",
    });
    expect((out.risk as any).basis).toBe("l3");
    expect((out.risk as any).residual.daily_variance_usd2).toBeCloseTo(100_000 ** 2 * 9e-4 * 0.4, 4);
    expect(out.coverage.excluded_from_lstar).toEqual([]);
  });

  it("uses L3 for a name with no L* (pre-2013 dates), counts it under l3 and warns", () => {
    const out = computeSignedExposure({
      stocks: [stock("A", 100_000, withLevels(1)), stock("NOL", 10_000, withLevels(null))],
      directEtfs: [],
      inputGrossUsd: 110_000,
      cov: COV,
    });
    expect(out.coverage.excluded_from_lstar).toEqual([]);
    expect((out.hedges.lstar as any).names_by_level).toEqual({ l1: 1, l2: 0, l3: 1 });
    // A at L1 (SPY only); NOL at L3 (three legs).
    const trade = (out.hedges.lstar as any).stock_hedge_trade_usd;
    expect(trade.SPY).toBeCloseTo(100_000 * -1.8 + 10_000 * -0.5, 2);
    expect(trade.XLK).toBeCloseTo(10_000 * -0.4, 2);
    expect(trade.SMH).toBeCloseTo(10_000 * -0.7, 2);
    // Residual: A at l1_res_er, NOL at l3_res_er.
    expect((out.risk as any).residual.daily_variance_usd2).toBeCloseTo(
      100_000 ** 2 * 9e-4 * 0.6 + 10_000 ** 2 * 9e-4 * 0.4,
      4,
    );
    expect(out.coverage.by_calculation.hedge_lstar).toBeCloseTo(1, 4);
    const w = out.warnings.find((x) => x.code === "lstar_unavailable_l3_fallback")!;
    expect(w.tickers).toEqual(["NOL"]);
    expect(w.message).toBe(
      "L* hedge levels are published from 2013-01-01. 1 name has no L* level at this date and uses L3 instead (counted under l3 in names_by_level).",
    );
  });

  it("the L3 fallback matches an explicit l3 request when no name has L*", () => {
    const stocks = [stock("A", 100_000, withLevels(null)), stock("B", -40_000, { ...AMD, lstar_level: null })];
    const fb = computeSignedExposure({ stocks, directEtfs: [], inputGrossUsd: 140_000, cov: COV });
    const l3 = computeSignedExposure({ stocks, directEtfs: [], inputGrossUsd: 140_000, cov: COV, basis: "l3" });
    expect((fb.hedges.lstar as any).stock_hedge_trade_usd).toEqual((l3.hedges.l3 as any).stock_hedge_trade_usd);
    expect((fb.risk as any).total).toEqual((l3.risk as any).total);
    expect(fb.warnings.find((w) => w.code === "lstar_unavailable_l3_fallback")!.message).toMatch(/2 names have no L\* level/);
  });

  it("excludes a name with neither L* nor complete L3 data, without a fallback warning", () => {
    const { l3_sub_hr: _drop, ...noL3 } = withLevels(null);
    const out = computeSignedExposure({
      stocks: [stock("A", 100_000, withLevels(3)), stock("NOL", 10_000, noL3)],
      directEtfs: [],
      inputGrossUsd: 110_000,
      cov: COV,
    });
    expect(out.coverage.excluded_from_lstar).toMatchObject([{ ticker: "NOL", value_usd: 10_000, reason: "no_lstar" }]);
    expect(out.coverage.excluded_from_lstar[0]!.detail).toMatch(/No L\* level/);
    expect((out.hedges.lstar as any).names_by_level).toEqual({ l1: 0, l2: 0, l3: 1 });
    expect((out.hedges.lstar as any).stock_hedge_trade_usd.SPY).toBeCloseTo(100_000 * -0.5, 2);
    expect(out.coverage.by_calculation.hedge_lstar).toBeCloseTo(100_000 / 110_000, 4);
    expect(out.warnings.map((w) => w.code)).not.toContain("lstar_unavailable_l3_fallback");
  });

  it("names with L* get no fallback warning", () => {
    const out = computeSignedExposure({
      stocks: [stock("A", 100_000, withLevels(2))],
      directEtfs: [],
      inputGrossUsd: 100_000,
      cov: COV,
    });
    expect(out.warnings.map((w) => w.code)).not.toContain("lstar_unavailable_l3_fallback");
  });

  it("excludes a name whose L* level lacks data", () => {
    const { l2_mkt_hr: _drop, ...noL2 } = withLevels(2);
    const out = computeSignedExposure({
      stocks: [stock("GAP", 10_000, noL2)],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect(out.coverage.excluded_from_lstar).toMatchObject([{ ticker: "GAP", value_usd: 10_000, reason: "lstar_level_incomplete" }]);
    expect(out.coverage.by_calculation.hedge_lstar).toBe(0);
  });

  it("an explicit level does not report L* exclusions", () => {
    const out = computeSignedExposure({
      stocks: [stock("NOL", 10_000, withLevels(null))],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
      basis: "l3",
    });
    expect(out.coverage.excluded_from_lstar).toEqual([]);
    expect(out.coverage.by_calculation.hedge_l3).toBeCloseTo(1, 4);
  });
});

describe("hedge_added_variance warning threshold (owner decision 2026-10-15)", () => {
  const run = (res: number) =>
    computeSignedExposure({
      stocks: [stock("BRK", 10_000, { ...NVDA, l1_res_er: res, lstar_level: 1 })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });

  it("is 1.02", () => {
    expect(HEDGE_ADDED_VARIANCE_WARN_THRESHOLD).toBe(1.02);
  });

  it.each([1.0001, 1.02])("no warning at a residual share of %s, and the share is still used as is", (res) => {
    const r = run(res);
    expect(r.warnings.map((w) => w.code)).not.toContain("hedge_added_variance");
    expect((r.risk as any).residual.hedge_added_variance).toEqual([]);
    expect((r.risk as any).residual.daily_variance_usd2).toBeCloseTo(10_000 ** 2 * 9e-4 * res, 4);
  });

  it("warns at a residual share of 1.021", () => {
    const r = run(1.021);
    expect(r.warnings.map((w) => w.code)).toEqual(["hedge_added_variance"]);
    expect((r.risk as any).residual.hedge_added_variance).toEqual([{ ticker: "BRK", level: "l1", residual_share: 1.021 }]);
  });
});

describe("market beta on the risk basis", () => {
  const varSpy = COV.S[0]![0]!;
  const betaOf = (x: number[]) => x.reduce((a, xi, i) => a + xi * COV.S[i]![0]!, 0) / varSpy;

  it("is xᵀΣe_SPY/σ²_SPY of the exposure vector, kept apart from the L1 beta", () => {
    const book = [stock("NVDA", 100_000, NVDA), stock("AMD", -60_000, AMD)];
    const out = computeSignedExposure({
      stocks: book,
      directEtfs: [{ ticker: "XLK", value: 20_000 }],
      inputGrossUsd: 180_000,
      cov: COV,
    });
    const x = [
      -(100_000 * -0.5 - 60_000 * -0.6),
      -(100_000 * -0.4 - 60_000 * -0.3) + 20_000,
      -(100_000 * -0.7 - 60_000 * -0.9),
    ];
    const rb = out.beta.risk_basis!;
    expect(rb.beta_usd).toBeCloseTo(betaOf(x), 1);
    expect(rb.beta_pct_of_gross).toBeCloseTo(betaOf(x) / 180_000, 4);
    expect(rb.basis).toBe("lstar");
    expect(rb.gross_covered).toBe(1);
    const layers = rb.by_layer_usd as Record<string, number>;
    expect(layers.market! + layers.sector! + layers.subsector! + layers.direct_etf!).toBeCloseTo(rb.beta_usd, 0);
    expect(layers.direct_etf).toBeCloseTo((20_000 * COV.S[1]![0]!) / varSpy, 1);
    // The L1 field is unchanged and labelled.
    expect(out.beta.method).toBe("l1_market_beta");
    expect(out.beta.stock_beta_usd).toBeCloseTo(100_000 * 1.8 - 60_000 * 2.0, 2);
    expect(rb.beta_usd).not.toBeCloseTo(out.beta.total_beta_usd, 0);
  });

  it("equals the L1 beta-dollars under hedge_level l1 (L1 has one factor, SPY)", () => {
    const out = computeSignedExposure({
      stocks: [stock("NVDA", 100_000, NVDA), stock("AMD", -60_000, AMD)],
      directEtfs: [],
      inputGrossUsd: 160_000,
      cov: COV,
      basis: "l1",
    });
    expect(out.beta.risk_basis!.beta_usd).toBeCloseTo(out.beta.total_beta_usd, 2);
  });

  it("is null without a covariance", () => {
    const out = computeSignedExposure({ stocks: [stock("NVDA", 1_000, NVDA)], directEtfs: [], inputGrossUsd: 1_000, cov: null });
    expect(out.beta.risk_basis).toBeNull();
  });
});

describe("scenario inputs", () => {
  const book = [stock("NVDA", 100_000, NVDA), stock("AMD", -60_000, AMD)];

  it("gives each ETF's beta to SPY, volatility, holding and hedge-leg flag", () => {
    const out = computeSignedExposure({
      stocks: book,
      directEtfs: [{ ticker: "XLK", value: 20_000 }, { ticker: "EFA", value: 5_000 }],
      inputGrossUsd: 185_000,
      cov: COV,
    });
    const si = out.scenario_inputs as any;
    const byTicker = Object.fromEntries(si.etfs.map((e: any) => [e.ticker, e]));
    expect(byTicker.SPY.beta_to_spy).toBe(1);
    expect(byTicker.XLK.beta_to_spy).toBeCloseTo(1.1, 4);
    expect(byTicker.SMH.beta_to_spy).toBeCloseTo(1.3, 4);
    expect(byTicker.SMH.annual_vol).toBeCloseTo(Math.sqrt(3.0e-4 * 252), 4);
    expect(byTicker.XLK).toMatchObject({ held_usd: 20_000, hedge_leg: true, in_covariance: true });
    // An ETF held without covariance is listed with no beta.
    expect(byTicker.EFA).toMatchObject({ beta_to_spy: null, annual_vol: null, held_usd: 5_000, hedge_leg: false, in_covariance: false });
    // Matches the existing direct_etf_betas for ETFs held.
    expect(out.beta.direct_etf_betas.XLK).toBe(byTicker.XLK.beta_to_spy);
    expect(si.positions_included).toBe(false);
    expect(si.positions).toBeUndefined();
  });

  it("adds per-name rows only when include_positions is set", () => {
    const out = computeSignedExposure({ stocks: book, directEtfs: [], inputGrossUsd: 160_000, cov: COV, includePositions: true });
    const rows = (out.scenario_inputs as any).positions;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      ticker: "NVDA",
      tickers: ["NVDA"],
      value_usd: 100_000,
      sector_etf: "XLK",
      subsector_etf: "SMH",
      level: "l3",
      excluded_reason: null,
      l1_beta: 1.8,
      hedge_ratios: { SPY: -0.5, XLK: -0.4, SMH: -0.7 },
      residual_share: 0.4,
      residual_vol_annual: Number(Math.sqrt(9e-4 * 0.4 * 252).toFixed(4)),
      residual_vol_annual_usd: Math.round(100_000 * Math.sqrt(9e-4 * 0.4 * 252) * 100) / 100,
    });
  });

  it("per-name rows carry the level used and an exclusion reason", () => {
    const out = computeSignedExposure({
      stocks: [stock("NOL", 10_000, { ...NVDA, lstar_level: null, l3_res_er: null })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
      includePositions: true,
    });
    const row = (out.scenario_inputs as any).positions[0];
    expect(row).toMatchObject({ level: null, excluded_reason: "no_lstar", hedge_ratios: null, residual_vol_annual: null });
  });
});

describe("top_contributors length", () => {
  const many = Array.from({ length: 20 }, (_, i) => stock(`N${i}`, 1_000 * (i + 1), NVDA));
  const run = (topContributors?: number | "all") =>
    (computeSignedExposure({ stocks: many, directEtfs: [], inputGrossUsd: 210_000, cov: COV, topContributors }).risk as any)
      .residual.top_contributors;

  it("defaults to 15", () => expect(run()).toHaveLength(15));
  it("takes a number", () => expect(run(3).map((r: any) => r.ticker)).toEqual(["N19", "N18", "N17"]));
  it('"all" lists every name', () => expect(run("all")).toHaveLength(20));
});
