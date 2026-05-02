import { describe, expect, it } from "vitest";
import { formatFundMetrics } from "@/lib/funds/format";
import type { FundLatestRow, FundRow } from "@/lib/dal/funds-engine";

const FUND: FundRow = {
  bw_fund_id: "BW-FUND-S000004310",
  series_id: "S000004310",
  ticker: "VFINX",
  cik: "0000036405",
  fund_name: "Vanguard 500 Index Fund Investor Shares",
  morningstar_category: "Large Blend",
  equity_style_9box: "Large Blend",
  style_link_method: "ticker_match",
  primary_bw_fund_id: null,
  latest_report_date: "2026-04-30",
  latest_filing_date: "2026-07-14",
  latest_extracted_at: "2026-05-02T16:38:21.330085+00:00",
  latest_total_adj_mv: 25_000_000_000,
  latest_n_holdings: 503,
  latest_effective_n: 102.4,
  last_in_eligible_universe_at: null,
  metadata: {},
};

const LATEST: FundLatestRow = {
  bw_fund_id: "BW-FUND-S000004310",
  report_date: "2026-04-30",
  filing_date: "2026-07-14",
  extracted_at: "2026-05-02T16:38:21.330085+00:00",
  portfolio_gross_return: 0.071,
  portfolio_market_return: 0.099,
  portfolio_sector_return: -0.01,
  portfolio_subsector_return: -0.01,
  portfolio_idiosyncratic_return: -0.005,
  identity_residual: -0.003,
  weight_sum: 0.99,
  n_holdings_active: 503,
  effective_n: 102.4,
  top10_weight_sum: 0.34,
  total_adj_mv: 25_000_000_000,
  equity_style_9box: "Large Blend",
  n_funds_in_cell_at_report_date: 1234,
  model_version: "funds_dag.v20260502",
  factor_set_id: "uni_mc_3000_SPY",
  last_synced_at: "2026-05-02T16:41:31.441605+00:00",
  metadata: {},
};

describe("formatFundMetrics", () => {
  it("nests return components under `returns` and diagnostics under `diagnostics`", () => {
    const r = formatFundMetrics(FUND, LATEST);
    expect(r.returns.gross).toBeCloseTo(0.071);
    expect(r.returns.market).toBeCloseTo(0.099);
    expect(r.returns.identity_residual).toBeCloseTo(-0.003);
    expect(r.diagnostics.effective_n).toBeCloseTo(102.4);
    expect(r.diagnostics.top10_weight_sum).toBeCloseTo(0.34);
  });

  it("surfaces the bitemporal triple at the top level", () => {
    const r = formatFundMetrics(FUND, LATEST);
    expect(r.report_date).toBe("2026-04-30");
    expect(r.filing_date).toBe("2026-07-14");
    expect(r.extracted_at).toBe("2026-05-02T16:38:21.330085+00:00");
  });

  it("composes _metadata with model_version + data_as_of from latest row", () => {
    const r = formatFundMetrics(FUND, LATEST);
    expect(r._metadata.model_version).toBe("funds_dag.v20260502");
    expect(r._metadata.factor_set_id).toBe("uni_mc_3000_SPY");
    expect(r._metadata.data_as_of).toBe("2026-04-30");
    expect(r._metadata.last_synced_at).toBe(
      "2026-05-02T16:41:31.441605+00:00",
    );
  });

  it("falls back to latest.equity_style_9box when registry row's column is null", () => {
    const fundNoStyle = { ...FUND, equity_style_9box: null };
    const r = formatFundMetrics(fundNoStyle, LATEST);
    expect(r.equity_style_9box).toBe("Large Blend");
  });

  it("preserves null returns / diagnostics rather than substituting zero", () => {
    const sparseLatest = {
      ...LATEST,
      portfolio_gross_return: null,
      effective_n: null,
      identity_residual: null,
    };
    const r = formatFundMetrics(FUND, sparseLatest);
    expect(r.returns.gross).toBeNull();
    expect(r.returns.identity_residual).toBeNull();
    expect(r.diagnostics.effective_n).toBeNull();
  });

  it("includes registry-side meta (morningstar_category, primary_bw_fund_id)", () => {
    const r = formatFundMetrics(FUND, LATEST);
    expect(r.meta.morningstar_category).toBe("Large Blend");
    expect(r.meta.primary_bw_fund_id).toBeNull();
    expect(r.meta.total_adj_mv).toBe(25_000_000_000);
    expect(r.meta.n_funds_in_cell_at_report_date).toBe(1234);
  });
});
