/**
 * 13F Filer snapshot composer — assembles the JSON shape for the per-filer
 * snapshot endpoint (`/api/13f/filers/{id}/snapshot`). Mirrors the fund
 * composer's pattern: pure function, no I/O, no network. Route handlers do
 * the parallel-fetch and call this.
 *
 * Plan reference: BWMACRO/docs/13f_pipeline_plan.md §7.4.
 *
 * Differences from FundSnapshot:
 *   - `nav_history` is intentionally absent (filers have no NAV time series).
 *   - `cohort_context` axis is filer_type × aum_tier (not equity_style_9box).
 *   - Includes a portfolio-derived `style_attribution` block from the
 *     D.8.3 kernel — the only 9-box signal on the filer side.
 *   - A `coverage` block always reports the in-ERM3 fraction so consumers
 *     never confuse a low-coverage filer with a non-modelable one.
 *   - Hedge is absent today — Phase 3 follow-on (D.8.10).
 */

import type {
  FilerRankingRow,
  FilerRow,
  FilerPortfolioLatestRow,
} from "@/lib/dal/filers-engine";
import type {
  FilerHoldingsSnapshot,
  FilerPortfolioRow,
} from "@/lib/dal/funds-zarr-reader";
import {
  formatFilerMetrics,
  type FilerMetricsResponse,
} from "@/lib/13f/format";

const FILER_LOOKBACK_MONTHS = 12;

export interface FilerSnapshotPrimitives {
  filer: FilerRow;
  latest: FilerPortfolioLatestRow | null;
  holdings: FilerHoldingsSnapshot | null;
  portfolioHistory: FilerPortfolioRow[];
  cohortRanks: FilerRankingRow[];
}

export interface FilerCohortRankEntry {
  partition_type: "filer_type" | "aum_tier";
  partition_value: string;
  metric: string;
  period_window: string;
  rank: number;
  cohort_size: number | null;
  value: number | null;
}

export interface FilerSnapshot {
  /** Discriminator so renderers can branch off this rather than route shape. */
  entity_kind: "13f_filer";
  bw_filer_id: string;
  cik: string | null;
  name: string | null;
  filer_type: string | null;
  filer_subtype: string | null;
  aum_tier: string | null;
  /** Always present, may be null until Phase 2 sync writers populate it. */
  report_date: string | null;
  filing_date: string | null;
  metrics: FilerMetricsResponse;
  holdings: {
    n_total_holdings: number;
    n_returned: number;
    top: FilerHoldingsSnapshot["holdings"];
  } | null;
  portfolio_history: {
    lookback_months: number;
    n_periods: number;
    rows: FilerPortfolioRow[];
  };
  /**
   * Portfolio-derived 9-box attribution. The filer side has no Morningstar
   * share-class signal — this is the only 9-box we ever surface on filers.
   * Computed on weights renormalized to the in-ERM3 subset (per
   * BWMACRO/docs/13f_pipeline_plan.md §5).
   */
  style_attribution: {
    portfolio_9box_distribution: Record<string, number> | null;
    dominant_9box: string | null;
    portfolio_style_hhi: number | null;
    effective_n_styles: number | null;
  } | null;
  /**
   * ERM3-universe coverage diagnostics. Always reported — never used as an
   * inclusion gate. Filers legitimately run lower coverage than funds
   * (global L/S, activists with EU exposure).
   */
  coverage: {
    coverage_in_erm3: number | null;
    aum_in_erm3: number | null;
    n_holdings_in_erm3: number | null;
    effective_n_in_erm3: number | null;
  };
  /**
   * Filer modelability gate result. A filer can have low coverage_in_erm3
   * and still be modelable — what matters is whether the in-ERM3 sub-
   * portfolio carries signal (n_holdings_in_erm3 ≥ 10 + effective_n_in_erm3
   * ≥ 5 + n_real_13f_filings ≥ 4 + filer_type filter).
   */
  is_modelable: boolean | null;
  cohort_context: {
    partition_axes: Array<"filer_type" | "aum_tier">;
    ranks: FilerCohortRankEntry[];
  } | null;
  _metadata: {
    model_version: string | null;
    factor_set_id: string | null;
    data_as_of: string | null;
    data_freshness: string | null;
    /** Permanent: 13F filers have no NAV. Surfaced explicitly so consumers don't hunt for it. */
    nav_applicable: false;
  };
}

export function composeFilerSnapshot(
  p: FilerSnapshotPrimitives,
): FilerSnapshot {
  const { filer, latest, holdings, portfolioHistory, cohortRanks } = p;

  const trimmed = trimToLookbackMonths(portfolioHistory, FILER_LOOKBACK_MONTHS);

  const ranks: FilerCohortRankEntry[] = cohortRanks.map((r) => ({
    partition_type: r.partition_type,
    partition_value: r.partition_value,
    metric: r.metric,
    period_window: r.period_window,
    rank: r.rank,
    cohort_size: r.cohort_size,
    value: r.value,
  }));

  const partitionAxes = Array.from(
    new Set(cohortRanks.map((r) => r.partition_type)),
  ) as Array<"filer_type" | "aum_tier">;

  const styleAttribution =
    latest &&
    (latest.portfolio_9box_distribution !== null ||
      latest.dominant_9box !== null ||
      latest.portfolio_style_hhi !== null)
      ? {
          portfolio_9box_distribution: latest.portfolio_9box_distribution,
          dominant_9box: latest.dominant_9box,
          portfolio_style_hhi: latest.portfolio_style_hhi,
          effective_n_styles: latest.effective_n_styles,
        }
      : null;

  return {
    entity_kind: "13f_filer",
    bw_filer_id: filer.bw_filer_id,
    cik: filer.cik,
    name: filer.name,
    filer_type: filer.filer_type,
    filer_subtype: filer.filer_subtype,
    aum_tier: filer.aum_tier,
    report_date: latest?.report_date ?? filer.latest_report_date,
    filing_date: latest?.filing_date ?? filer.latest_filing_date,
    metrics: formatFilerMetrics(filer, latest),
    holdings: holdings
      ? {
          n_total_holdings: holdings.n_total_holdings,
          n_returned: holdings.n_holdings_returned,
          top: holdings.holdings,
        }
      : null,
    portfolio_history: {
      lookback_months: FILER_LOOKBACK_MONTHS,
      n_periods: trimmed.length,
      rows: trimmed,
    },
    style_attribution: styleAttribution,
    coverage: {
      coverage_in_erm3: latest?.coverage_in_erm3 ?? null,
      aum_in_erm3: latest?.aum_in_erm3 ?? null,
      n_holdings_in_erm3: latest?.n_holdings_in_erm3 ?? null,
      effective_n_in_erm3: latest?.effective_n_in_erm3 ?? null,
    },
    is_modelable: latest?.is_modelable ?? null,
    cohort_context: ranks.length > 0
      ? {
          partition_axes: partitionAxes,
          ranks,
        }
      : null,
    _metadata: {
      model_version: latest?.model_version ?? null,
      factor_set_id: latest?.factor_set_id ?? null,
      data_as_of: latest?.report_date ?? filer.latest_report_date,
      data_freshness: latest?.last_synced_at ?? null,
      nav_applicable: false,
    },
  };
}

function trimToLookbackMonths(
  rows: FilerPortfolioRow[],
  months: number,
): FilerPortfolioRow[] {
  if (rows.length <= months) return rows;
  return rows.slice(rows.length - months);
}
