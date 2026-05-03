/**
 * Snapshot composer — assembles the JSON shape for the public per-fund and
 * per-cohort snapshot endpoints (`/api/funds/snapshot/{id}` and
 * `/api/funds/style/{slug}/snapshot`).
 *
 * Both functions are pure: they take already-fetched primitives (DAL +
 * Zarr-reader outputs) and return the composed JSON. No I/O, no network.
 * Route handlers do the parallel-fetch and call these functions.
 *
 * The cohort context block on the fund snapshot ("rank N of cohort_size on
 * each metric, per period_window") is the differentiated view: tells a
 * subscriber how their fund stacks up against peers in its 9-box cell on
 * every dimension we rank, not just one cherry-picked metric.
 */

import type {
  FundLatestRow,
  FundRow,
  StylePortfolioRow,
  StyleRankingRow,
} from "@/lib/dal/funds-engine";
import type {
  CohortHoldingsSnapshot,
  CohortPortfolioRow,
  FundHedgeSnapshot,
  FundHoldingsSnapshot,
  FundPortfolioRow,
} from "@/lib/dal/funds-zarr-reader";
import { formatFundMetrics, type FundMetricsResponse } from "@/lib/funds/format";

const FUND_LOOKBACK_MONTHS = 12;
const COHORT_LOOKBACK_MONTHS = 12;

// ---------------------------------------------------------------------------
// Per-fund snapshot
// ---------------------------------------------------------------------------

export interface FundSnapshotPrimitives {
  fund: FundRow;
  latest: FundLatestRow;
  holdings: FundHoldingsSnapshot | null;
  hedge: FundHedgeSnapshot | null;
  portfolioHistory: FundPortfolioRow[];
  cohortRanks: StyleRankingRow[];
  /** Optional cell metrics (e.g. for n_funds_in_cell when the fund's cell row exists). */
  cohortMetrics: StylePortfolioRow[];
}

export interface FundCohortRankEntry {
  metric: string;
  period_window: string;
  rank: number;
  cohort_size: number | null;
  value: number | null;
}

export interface FundSnapshot {
  bw_fund_id: string;
  ticker: string | null;
  fund_name: string | null;
  equity_style_9box: string | null;
  report_date: string;
  filing_date: string;
  metrics: FundMetricsResponse;
  holdings: {
    n_total_holdings: number;
    n_returned: number;
    top: FundHoldingsSnapshot["holdings"];
  } | null;
  hedge: FundHedgeSnapshot | null;
  portfolio_history: {
    lookback_months: number;
    n_periods: number;
    rows: FundPortfolioRow[];
  };
  cohort_context: {
    equity_style_9box: string | null;
    n_funds_in_cell: number | null;
    ranks: FundCohortRankEntry[];
  } | null;
  _metadata: {
    model_version: string | null;
    factor_set_id: string | null;
    data_as_of: string;
    data_freshness: string;
  };
}

export function composeFundSnapshot(p: FundSnapshotPrimitives): FundSnapshot {
  const { fund, latest, holdings, hedge, portfolioHistory, cohortRanks } = p;

  const trimmed = trimToLookbackMonths(portfolioHistory, FUND_LOOKBACK_MONTHS);

  const ranks: FundCohortRankEntry[] = cohortRanks.map((r) => ({
    metric: r.metric,
    period_window: r.period_window,
    rank: r.rank,
    cohort_size: r.cohort_size,
    value: r.value,
  }));

  // Pick the cell-size hint with the most coverage across EW/MV rows. Both rows
  // typically carry the same n_funds_in_cell in practice; if they differ, take max.
  let nFundsInCell = latest.n_funds_in_cell_at_report_date ?? null;
  for (const m of p.cohortMetrics) {
    if (m.n_funds_in_cell != null) {
      nFundsInCell = nFundsInCell == null
        ? m.n_funds_in_cell
        : Math.max(nFundsInCell, m.n_funds_in_cell);
    }
  }

  return {
    bw_fund_id: fund.bw_fund_id,
    ticker: fund.ticker,
    fund_name: fund.fund_name,
    equity_style_9box: fund.equity_style_9box ?? latest.equity_style_9box,
    report_date: latest.report_date,
    filing_date: latest.filing_date,
    metrics: formatFundMetrics(fund, latest),
    holdings: holdings
      ? {
          n_total_holdings: holdings.n_total_holdings,
          n_returned: holdings.n_holdings_returned,
          top: holdings.holdings,
        }
      : null,
    hedge,
    portfolio_history: {
      lookback_months: FUND_LOOKBACK_MONTHS,
      n_periods: trimmed.length,
      rows: trimmed,
    },
    cohort_context: fund.equity_style_9box
      ? {
          equity_style_9box: fund.equity_style_9box,
          n_funds_in_cell: nFundsInCell,
          ranks,
        }
      : null,
    _metadata: {
      model_version: latest.model_version,
      factor_set_id: latest.factor_set_id,
      data_as_of: latest.report_date,
      data_freshness: latest.last_synced_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-cohort (style cell) snapshot
// ---------------------------------------------------------------------------

export interface CohortSnapshotPrimitives {
  cellName: string;
  slug: string;
  cohortMetrics: StylePortfolioRow[];
  topFunds: StyleRankingRow[];
  topSymbols: StyleRankingRow[];
  portfolioHistory: CohortPortfolioRow[];
  cohortHoldings: CohortHoldingsSnapshot | null;
}

export interface CohortRankEntry {
  rank: number;
  entity_id: string;
  value: number | null;
  cohort_size: number | null;
}

export interface CohortSnapshot {
  equity_style_9box: string;
  slug: string;
  report_date: string;
  filing_date_max: string | null;
  n_funds_in_cell: number | null;
  metrics: {
    weightings: Record<string, unknown>;
  };
  holdings: {
    weighting: "ew" | "mv";
    n_total_holdings: number;
    n_returned: number;
    top: CohortHoldingsSnapshot["holdings"];
  } | null;
  portfolio_history: {
    lookback_months: number;
    n_periods: number;
    rows: CohortPortfolioRow[];
  };
  top_funds: {
    metric: string;
    period_window: string;
    weighting: string;
    rows: CohortRankEntry[];
  } | null;
  top_symbols: {
    metric: string;
    period_window: string;
    weighting: string;
    rows: CohortRankEntry[];
  } | null;
  _metadata: {
    model_version: string | null;
    data_as_of: string;
    data_freshness: string;
  };
}

export function composeCohortSnapshot(
  p: CohortSnapshotPrimitives,
): CohortSnapshot | null {
  const { cellName, slug, cohortMetrics } = p;
  if (cohortMetrics.length === 0) return null;

  // Aggregate metrics into the per-weighting nested shape from C.0.
  const weightings: Record<string, unknown> = {};
  let reportDate = cohortMetrics[0]!.report_date;
  let filingDateMax = cohortMetrics[0]!.filing_date_max;
  let modelVersion = cohortMetrics[0]!.model_version;
  let lastSyncedAt = cohortMetrics[0]!.last_synced_at;
  let nFundsInCell = cohortMetrics[0]!.n_funds_in_cell;
  for (const m of cohortMetrics) {
    weightings[m.weighting] = {
      portfolio_gross_return: m.portfolio_gross_return,
      portfolio_market_return: m.portfolio_market_return,
      portfolio_sector_return: m.portfolio_sector_return,
      portfolio_subsector_return: m.portfolio_subsector_return,
      portfolio_idiosyncratic_return: m.portfolio_idiosyncratic_return,
      identity_residual: m.identity_residual,
      weight_sum: m.weight_sum,
      n_holdings_active: m.n_holdings_active,
      effective_n: m.effective_n,
      top10_weight_sum: m.top10_weight_sum,
    };
    if (m.report_date > reportDate) reportDate = m.report_date;
    if (m.filing_date_max && (!filingDateMax || m.filing_date_max > filingDateMax)) {
      filingDateMax = m.filing_date_max;
    }
    if (m.last_synced_at > lastSyncedAt) lastSyncedAt = m.last_synced_at;
    if (m.model_version) modelVersion = m.model_version;
    if (m.n_funds_in_cell != null) {
      nFundsInCell = nFundsInCell == null
        ? m.n_funds_in_cell
        : Math.max(nFundsInCell, m.n_funds_in_cell);
    }
  }

  const trimmedHistory = trimCohortToLookbackMonths(
    p.portfolioHistory,
    COHORT_LOOKBACK_MONTHS,
  );

  return {
    equity_style_9box: cellName,
    slug,
    report_date: reportDate,
    filing_date_max: filingDateMax,
    n_funds_in_cell: nFundsInCell,
    metrics: { weightings },
    holdings: p.cohortHoldings
      ? {
          weighting: p.cohortHoldings.weighting,
          n_total_holdings: p.cohortHoldings.n_total_holdings,
          n_returned: p.cohortHoldings.n_returned,
          top: p.cohortHoldings.holdings,
        }
      : null,
    portfolio_history: {
      lookback_months: COHORT_LOOKBACK_MONTHS,
      n_periods: trimmedHistory.length,
      rows: trimmedHistory,
    },
    top_funds: rankBlock(p.topFunds),
    top_symbols: rankBlock(p.topSymbols),
    _metadata: {
      model_version: modelVersion,
      data_as_of: reportDate,
      data_freshness: lastSyncedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Keep at most the trailing N teos from a chronologically-ordered series.
 * Teos are YYYY-MM-DD month-ends; we don't need to parse — string sort is
 * lexicographic-correct for ISO dates.
 */
function trimToLookbackMonths(
  rows: FundPortfolioRow[],
  months: number,
): FundPortfolioRow[] {
  if (rows.length <= months) return rows;
  return rows.slice(rows.length - months);
}

function trimCohortToLookbackMonths(
  rows: CohortPortfolioRow[],
  months: number,
): CohortPortfolioRow[] {
  if (rows.length <= months) return rows;
  return rows.slice(rows.length - months);
}

/**
 * Wrap a list of `style_rankings_top` rows (already filtered to one
 * cohort_type × metric × period_window × weighting tuple, sorted by rank)
 * into the snapshot's rank-block shape. Returns null when the list is empty.
 */
function rankBlock(rows: StyleRankingRow[]): {
  metric: string;
  period_window: string;
  weighting: string;
  rows: CohortRankEntry[];
} | null {
  if (rows.length === 0) return null;
  const head = rows[0]!;
  return {
    metric: head.metric,
    period_window: head.period_window,
    weighting: head.weighting,
    rows: rows.map((r) => ({
      rank: r.rank,
      entity_id: r.entity_id,
      value: r.value,
      cohort_size: r.cohort_size,
    })),
  };
}
