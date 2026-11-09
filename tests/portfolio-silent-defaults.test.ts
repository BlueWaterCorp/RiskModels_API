/**
 * Regression rows are copied from the XBI 2026-08-06 store cells already
 * pinned in cohort-variance-shares.test.ts.
 */
import { describe, expect, it } from "vitest";
import { computeDiversificationMetrics } from "@/lib/portfolio/portfolio-diversification";
import {
  computePortfolioER,
  computePortfolioLstarAttribution,
} from "@/lib/portfolio/portfolio-risk-core";

const REAL_ROWS = [
  { ticker: "MDGL", market: 0.00406, sector: 0.01648, subsector: 0.11038, residual: 0.86908 },
  { ticker: "ACAD", market: 0.08137, sector: 0.12097, subsector: 0.10262, residual: 0.69504 },
  { ticker: "INCY", market: -0.00009, sector: 0.18832, subsector: 0.0349, residual: 0.77686 },
] as const;

const metricMap = (missingResidualFor?: string) => new Map(
  REAL_ROWS.map((row) => [
    row.ticker,
    {
      l3_mkt_er: row.market,
      l3_sec_er: row.sector,
      l3_sub_er: row.subsector,
      l3_res_er: row.ticker === missingResidualFor ? null : row.residual,
    },
  ]),
);

describe("portfolio ER missing-value coverage", () => {
  it("keeps complete real rows identical to the prior weighted sum", () => {
    const weights = new Map(REAL_ROWS.map((row) => [row.ticker, 1 / 3]));
    const result = computePortfolioER(metricMap(), weights);

    expect(result.market).toBeCloseTo(REAL_ROWS.reduce((sum, row) => sum + row.market / 3, 0), 12);
    expect(result.residual).toBeCloseTo(REAL_ROWS.reduce((sum, row) => sum + row.residual / 3, 0), 12);
    expect(result.er_coverage).toBe(1);
    expect(result.data_quality_flags).toEqual([]);
  });

  it("excludes an incomplete real row without renormalizing covered weights", () => {
    const weights = new Map([["MDGL", 0.5], ["ACAD", 0.5]]);
    const result = computePortfolioER(metricMap("ACAD"), weights);

    expect(result.residual).toBeCloseTo(0.5 * REAL_ROWS[0].residual, 12);
    expect(result.er_coverage).toBe(0.5);
    expect(result.aggregation).toBe("covered_weights_not_renormalized");
    expect(result.data_quality_flags).toEqual(["portfolio_er_coverage_incomplete"]);
  });
});

describe("portfolio Lstar attribution missing-value coverage", () => {
  it("drops a chosen level with an incomplete ER vector", () => {
    const rows = new Map(
      [...metricMap("ACAD")].map(([ticker, metrics]) => [ticker, { ...metrics, lstar_level: 3 }]),
    );
    const result = computePortfolioLstarAttribution(
      rows,
      new Map([["MDGL", 0.5], ["ACAD", 0.5]]),
    );

    expect(result.residual).toBeCloseTo(0.5 * REAL_ROWS[0].residual, 12);
    expect(result.weight_covered).toBe(0.5);
    expect(result.dropped_count).toBe(1);
    expect(result.data_quality_flags).toEqual(["lstar_er_coverage_incomplete"]);
  });
});

describe("diversification missing-value coverage", () => {
  const positions = REAL_ROWS.slice(0, 2).map((row) => ({ ticker: row.ticker, weight: 0.5 }));
  const correlations = {
    sector: { etfs: [] as string[], R: [] as number[][] },
    subsector: { etfs: [] as string[], R: [] as number[][] },
  };
  const diversificationMetrics = (missingResidualFor?: string) => new Map(
    [...metricMap(missingResidualFor)].map(([ticker, values]) => [
      ticker,
      { ...values, sector_etf: null, subsector_etf: null },
    ]),
  );

  it("reports full coverage and preserves the complete-input naive result", () => {
    const result = computeDiversificationMetrics({
      positions,
      tickerMetrics: diversificationMetrics(),
      etfCorrelations: correlations,
      windowDays: 252,
    });
    expect(result.naive_pws.residual_er).toBeCloseTo(
      0.5 * (REAL_ROWS[0].residual + REAL_ROWS[1].residual),
      12,
    );
    expect(result.er_coverage).toBe(1);
    expect(result.data_quality_flags).toEqual([]);
  });

  it("reports partial coverage and does not turn the missing residual into zero", () => {
    const result = computeDiversificationMetrics({
      positions,
      tickerMetrics: diversificationMetrics("ACAD"),
      etfCorrelations: correlations,
      windowDays: 252,
    });
    expect(result.naive_pws.residual_er).toBeCloseTo(0.5 * REAL_ROWS[0].residual, 12);
    expect(result.er_coverage).toBe(0.5);
    expect(result.data_quality_flags).toContain("portfolio_er_coverage_incomplete");
  });
});
