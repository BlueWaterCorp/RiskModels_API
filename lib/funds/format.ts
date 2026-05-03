/**
 * Response shaping for the public funds metrics surface.
 *
 * Pure function: takes a registry row + funds_latest row + risk metadata,
 * returns the API response body. Mirrors the stocks-side shape under
 * `/metrics/{ticker}` — nested return / diagnostics / meta groups, plus a
 * `_metadata` block carrying lineage.
 *
 * Knowledge-mode only in v1; no `?as_of=` / `?mode=` (deferred to v2).
 */

import type { FundLatestRow, FundRow } from "@/lib/dal/funds-engine";

export interface FundMetricsResponse {
  bw_fund_id: string;
  ticker: string | null;
  fund_name: string | null;
  equity_style_9box: string | null;
  report_date: string;
  filing_date: string;
  extracted_at: string;
  returns: {
    gross: number | null;
    market: number | null;
    sector: number | null;
    subsector: number | null;
    idiosyncratic: number | null;
    identity_residual: number | null;
  };
  diagnostics: {
    weight_sum: number | null;
    n_holdings_active: number | null;
    effective_n: number | null;
    top10_weight_sum: number | null;
  };
  meta: {
    total_adj_mv: number | null;
    n_funds_in_cell_at_report_date: number | null;
    morningstar_category: string | null;
    primary_bw_fund_id: string | null;
  };
  _metadata: {
    model_version: string | null;
    factor_set_id: string | null;
    data_as_of: string;
    data_freshness: string;
    last_synced_at: string;
  };
}

export function formatFundMetrics(
  fund: FundRow,
  latest: FundLatestRow,
): FundMetricsResponse {
  return {
    bw_fund_id: fund.bw_fund_id,
    ticker: fund.ticker,
    fund_name: fund.fund_name,
    equity_style_9box: fund.equity_style_9box ?? latest.equity_style_9box,
    report_date: latest.report_date,
    filing_date: latest.filing_date,
    extracted_at: latest.extracted_at,
    returns: {
      gross: latest.portfolio_gross_return,
      market: latest.portfolio_market_return,
      sector: latest.portfolio_sector_return,
      subsector: latest.portfolio_subsector_return,
      idiosyncratic: latest.portfolio_idiosyncratic_return,
      identity_residual: latest.identity_residual,
    },
    diagnostics: {
      weight_sum: latest.weight_sum,
      n_holdings_active: latest.n_holdings_active,
      effective_n: latest.effective_n,
      top10_weight_sum: latest.top10_weight_sum,
    },
    meta: {
      total_adj_mv: latest.total_adj_mv,
      n_funds_in_cell_at_report_date: latest.n_funds_in_cell_at_report_date,
      morningstar_category: fund.morningstar_category,
      primary_bw_fund_id: fund.primary_bw_fund_id,
    },
    _metadata: {
      model_version: latest.model_version,
      factor_set_id: latest.factor_set_id,
      data_as_of: latest.report_date,
      data_freshness: latest.last_synced_at,
      last_synced_at: latest.last_synced_at,
    },
  };
}
