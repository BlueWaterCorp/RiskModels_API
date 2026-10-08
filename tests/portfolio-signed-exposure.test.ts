import { describe, expect, it } from "vitest";
import {
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
  stock_var: 9e-4, l3_res_er: 0.4,
};
const AMD = {
  l1_mkt_beta: 2.0, l1_mkt_hr: -2.0,
  l2_mkt_hr: -1.0, l2_sec_hr: -0.9,
  l3_mkt_hr: -0.6, l3_sec_hr: -0.3, l3_sub_hr: -0.9,
  stock_var: 1.2e-3, l3_res_er: 0.5,
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

  it("residual is the diagonal Σ v²·stock_var·l3_res_er", () => {
    const expected = 100_000 ** 2 * 9e-4 * 0.4 + 60_000 ** 2 * 1.2e-3 * 0.5;
    const risk = out.risk as any;
    expect(risk.residual.daily_variance_usd2).toBeCloseTo(expected, 4);
    expect(risk.residual.method).toBe("l3_residual_variance_diagonal_approximation");
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

  it("flags out-of-range residual shares instead of using them", () => {
    const bad = computeSignedExposure({
      stocks: [stock("BAD", 10_000, { ...NVDA, l3_res_er: 1.4 })],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect(bad.coverage.residual_flagged).toHaveLength(1);
    expect((bad.risk as any).residual.daily_variance_usd2).toBe(0);
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
    expect(out.coverage.lstar_fallback).toEqual([]);
  });

  it("falls back to the deepest usable level when a name has no L*, and reports it", () => {
    const out = computeSignedExposure({
      stocks: [stock("NOL", 10_000, withLevels(null))],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect(out.coverage.lstar_fallback).toEqual([{ ticker: "NOL", level: "l3" }]);
    expect((out.hedges.lstar as any).names_by_level).toEqual({ l1: 0, l2: 0, l3: 1 });
  });

  it("falls back when the L* level lacks data", () => {
    const { l2_mkt_hr: _drop, ...noL2 } = withLevels(2);
    const out = computeSignedExposure({
      stocks: [stock("GAP", 10_000, noL2)],
      directEtfs: [],
      inputGrossUsd: 10_000,
      cov: COV,
    });
    expect(out.coverage.lstar_fallback).toEqual([{ ticker: "GAP", level: "l3" }]);
  });
});
