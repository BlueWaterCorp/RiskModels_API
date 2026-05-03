/**
 * Funds DAL — Supabase reads against `public.funds` and `public.funds_latest`.
 *
 * Mirrors `lib/dal/risk-engine-v3.ts` (stocks side). Stage A surface only:
 * latest knowledge-mode snapshot. History (per-fund time series, holdings
 * panels) reads via the Zarr DAL in Stage B.
 *
 * Public/private boundary: this module backs the data-plane routes under
 * `/api/data/funds/*`. Metric/snapshot routes wrap these reads with
 * `withBilling()` in later stages.
 *
 * Bitemporal model carried in column shapes (`report_date` / `filing_date` /
 * `extracted_at`); v1 returns the latest knowledge-mode row only. `?as_of=`
 * is deferred to v2 per ARCHITECTURE_FUNDS_API.md §3.5.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FundRow {
  bw_fund_id: string;
  series_id: string | null;
  ticker: string | null;
  cik: string | null;
  fund_name: string | null;
  morningstar_category: string | null;
  equity_style_9box: string | null;
  style_link_method: string | null;
  primary_bw_fund_id: string | null;
  latest_report_date: string | null;
  latest_filing_date: string | null;
  latest_extracted_at: string | null;
  latest_total_adj_mv: number | null;
  latest_n_holdings: number | null;
  latest_effective_n: number | null;
  last_in_eligible_universe_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FundLatestRow {
  bw_fund_id: string;
  report_date: string;
  filing_date: string;
  extracted_at: string;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
  total_adj_mv: number | null;
  equity_style_9box: string | null;
  n_funds_in_cell_at_report_date: number | null;
  model_version: string | null;
  factor_set_id: string | null;
  last_synced_at: string;
  metadata: Record<string, unknown> | null;
}

export interface FundWithLatest {
  fund: FundRow;
  latest: FundLatestRow | null;
}

export interface SearchFundsOptions {
  q?: string;
  equityStyle9Box?: string | null;
  primaryOnly?: boolean;
  limit?: number;
}

const FUND_COLUMNS =
  "bw_fund_id, series_id, ticker, cik, fund_name, morningstar_category, equity_style_9box, style_link_method, primary_bw_fund_id, latest_report_date, latest_filing_date, latest_extracted_at, latest_total_adj_mv, latest_n_holdings, latest_effective_n, last_in_eligible_universe_at, metadata";

const FUND_LATEST_COLUMNS =
  "bw_fund_id, report_date, filing_date, extracted_at, portfolio_gross_return, portfolio_market_return, portfolio_sector_return, portfolio_subsector_return, portfolio_idiosyncratic_return, identity_residual, weight_sum, n_holdings_active, effective_n, top10_weight_sum, total_adj_mv, equity_style_9box, n_funds_in_cell_at_report_date, model_version, factor_set_id, last_synced_at, metadata";

export async function fetchFund(bwFundId: string): Promise<FundRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("funds")
      .select(FUND_COLUMNS)
      .eq("bw_fund_id", bwFundId)
      .maybeSingle();
    if (error) {
      console.error(`[Funds DAL] Error fetching fund ${bwFundId}:`, error);
      return null;
    }
    return (data as FundRow | null) ?? null;
  } catch (error) {
    console.error(`[Funds DAL] Error fetching fund ${bwFundId}:`, error);
    return null;
  }
}

export async function fetchFundLatest(
  bwFundId: string,
): Promise<FundLatestRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("funds_latest")
      .select(FUND_LATEST_COLUMNS)
      .eq("bw_fund_id", bwFundId)
      .maybeSingle();
    if (error) {
      console.error(
        `[Funds DAL] Error fetching funds_latest ${bwFundId}:`,
        error,
      );
      return null;
    }
    return (data as FundLatestRow | null) ?? null;
  } catch (error) {
    console.error(
      `[Funds DAL] Error fetching funds_latest ${bwFundId}:`,
      error,
    );
    return null;
  }
}

export async function resolveFundById(
  bwFundId: string,
): Promise<FundWithLatest | null> {
  const [fund, latest] = await Promise.all([
    fetchFund(bwFundId),
    fetchFundLatest(bwFundId),
  ]);
  if (!fund) return null;
  return { fund, latest };
}

export async function resolveFundsByIds(
  bwFundIds: string[],
): Promise<Map<string, FundWithLatest>> {
  const result = new Map<string, FundWithLatest>();
  if (bwFundIds.length === 0) return result;

  try {
    const admin = createAdminClient();
    const [fundsRes, latestRes] = await Promise.all([
      admin.from("funds").select(FUND_COLUMNS).in("bw_fund_id", bwFundIds),
      admin
        .from("funds_latest")
        .select(FUND_LATEST_COLUMNS)
        .in("bw_fund_id", bwFundIds),
    ]);

    if (fundsRes.error) {
      console.error("[Funds DAL] Batch funds error:", fundsRes.error);
      return result;
    }

    const latestById = new Map<string, FundLatestRow>();
    if (!latestRes.error) {
      for (const row of (latestRes.data ?? []) as FundLatestRow[]) {
        latestById.set(row.bw_fund_id, row);
      }
    } else {
      console.error("[Funds DAL] Batch funds_latest error:", latestRes.error);
    }

    for (const fund of (fundsRes.data ?? []) as FundRow[]) {
      result.set(fund.bw_fund_id, {
        fund,
        latest: latestById.get(fund.bw_fund_id) ?? null,
      });
    }
    return result;
  } catch (error) {
    console.error("[Funds DAL] Error in resolveFundsByIds:", error);
    return result;
  }
}

export async function searchFunds(
  options: SearchFundsOptions = {},
): Promise<FundRow[]> {
  const { q, equityStyle9Box, primaryOnly, limit = 50 } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  try {
    const admin = createAdminClient();
    let query = admin.from("funds").select(FUND_COLUMNS);

    if (q && q.trim().length > 0) {
      const escaped = q.trim().replace(/[%,()]/g, " ");
      query = query.or(
        `ticker.ilike.%${escaped}%,fund_name.ilike.%${escaped}%`,
      );
    }
    if (equityStyle9Box) {
      query = query.eq("equity_style_9box", equityStyle9Box);
    }
    if (primaryOnly) {
      query = query.is("primary_bw_fund_id", null);
    }

    query = query
      .order("latest_total_adj_mv", { ascending: false, nullsFirst: false })
      .limit(safeLimit);

    const { data, error } = await query;
    if (error) {
      console.error("[Funds DAL] searchFunds error:", error);
      return [];
    }
    return (data ?? []) as FundRow[];
  } catch (error) {
    console.error("[Funds DAL] searchFunds error:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cohort tables — style_portfolios_latest, style_rankings_top
// ---------------------------------------------------------------------------

export interface StylePortfolioRow {
  equity_style_9box: string;
  weighting: "ew" | "mv";
  report_date: string;
  filing_date_max: string | null;
  extracted_at: string | null;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
  n_funds_in_cell: number | null;
  model_version: string | null;
  last_synced_at: string;
  metadata: Record<string, unknown> | null;
}

const STYLE_PORTFOLIO_COLUMNS =
  "equity_style_9box, weighting, report_date, filing_date_max, extracted_at, portfolio_gross_return, portfolio_market_return, portfolio_sector_return, portfolio_subsector_return, portfolio_idiosyncratic_return, identity_residual, weight_sum, n_holdings_active, effective_n, top10_weight_sum, n_funds_in_cell, model_version, last_synced_at, metadata";

/**
 * Latest cohort metrics for a 9-box cell. Returns both EW + MV rows when
 * available (Slice 6 emits them side-by-side). Empty array if the cell has
 * no data yet.
 */
export async function fetchStyleCohortLatest(
  equityStyle9Box: string,
): Promise<StylePortfolioRow[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("style_portfolios_latest")
      .select(STYLE_PORTFOLIO_COLUMNS)
      .eq("equity_style_9box", equityStyle9Box);
    if (error) {
      console.error("[Funds DAL] fetchStyleCohortLatest error:", error);
      return [];
    }
    return (data ?? []) as StylePortfolioRow[];
  } catch (error) {
    console.error("[Funds DAL] fetchStyleCohortLatest error:", error);
    return [];
  }
}

export type CohortType = "symbol" | "sector" | "fund";
export type RankPeriodWindow = "1m" | "3m" | "12m" | "36m";
export type Weighting = "ew" | "mv";

export interface StyleRankingRow {
  rank: number;
  entity_id: string;
  metric: string;
  value: number | null;
  cohort_size: number | null;
  period_window: RankPeriodWindow;
  weighting: Weighting;
  report_date: string;
  filing_date_max: string | null;
}

export interface FetchStyleRankingsOptions {
  metric: string;
  cohortType: CohortType;
  periodWindow?: RankPeriodWindow;
  weighting?: Weighting;
  limit?: number;
}

const STYLE_RANKING_COLUMNS =
  "rank, entity_id, metric, value, cohort_size, period_window, weighting, report_date, filing_date_max";

/**
 * Top-N rankings within a 9-box cell × cohort_type × metric × period_window
 * × weighting. Always sorted by `rank` ascending. Cap N at 50 (data ceiling
 * per Slice 9 default). For `cohort_type='fund'` the writer stores `'ew'`
 * placeholder regardless of the requested weighting; we coerce here.
 */
export async function fetchStyleRankings(
  equityStyle9Box: string,
  options: FetchStyleRankingsOptions,
): Promise<StyleRankingRow[]> {
  const {
    metric,
    cohortType,
    periodWindow = "1m",
    limit = 25,
  } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  // For fund cohort: writer uses 'ew' as a NOT-NULL placeholder; ignore caller's choice.
  const effectiveWeighting: Weighting =
    cohortType === "fund" ? "ew" : options.weighting ?? "mv";

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("style_rankings_top")
      .select(STYLE_RANKING_COLUMNS)
      .eq("equity_style_9box", equityStyle9Box)
      .eq("cohort_type", cohortType)
      .eq("metric", metric)
      .eq("period_window", periodWindow)
      .eq("weighting", effectiveWeighting)
      .order("rank", { ascending: true })
      .limit(safeLimit);
    if (error) {
      console.error("[Funds DAL] fetchStyleRankings error:", error);
      return [];
    }
    return (data ?? []) as StyleRankingRow[];
  } catch (error) {
    console.error("[Funds DAL] fetchStyleRankings error:", error);
    return [];
  }
}

export async function getStyleCellMembers(
  equityStyle9Box: string,
  options: { primaryOnly?: boolean; limit?: number } = {},
): Promise<string[]> {
  const { primaryOnly, limit = 5000 } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 20000);

  try {
    const admin = createAdminClient();
    let query = admin
      .from("funds")
      .select("bw_fund_id")
      .eq("equity_style_9box", equityStyle9Box);
    if (primaryOnly) {
      query = query.is("primary_bw_fund_id", null);
    }
    query = query
      .order("latest_total_adj_mv", { ascending: false, nullsFirst: false })
      .limit(safeLimit);

    const { data, error } = await query;
    if (error) {
      console.error("[Funds DAL] getStyleCellMembers error:", error);
      return [];
    }
    return ((data ?? []) as { bw_fund_id: string }[]).map(
      (r) => r.bw_fund_id,
    );
  } catch (error) {
    console.error("[Funds DAL] getStyleCellMembers error:", error);
    return [];
  }
}
