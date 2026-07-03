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
  /** Net expense ratio of the representative (ticker_primary) share class, as a
   *  PERCENT per year (0.59 = 0.59%/yr, NOT 0.0059). Source: EODHD via Funds_DAG.
   *  Feeds the fee-justification analytic (active_fee = fund_ER − index_ER). */
  net_expense_ratio: number | null;
  /** As-of date of net_expense_ratio (EODHD expense_ratio_date); can trail by
   *  years — a staleness signal, not a current-fee guarantee. */
  net_expense_ratio_asof: string | null;
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
  /** v4 cascade (D.8.38): size+value style increment, diagnostic. */
  portfolio_style_return: number | null;
  /** v4 cascade (D.8.38): stock-specific residual, net of style. */
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
  // ERM3 risk decomposition + NAV/CAPM fit (D.8.x funds_supabase_sync).
  // Optional so pre-existing test fixtures / callers compile; the live
  // funds_latest row always carries them (selected in FUND_LATEST_COLUMNS).
  aum_erm3?: number | null;
  coverage_in_erm3?: number | null;
  variance_shares_full?: FundVarianceShares | null;
  variance_shares_recent?: FundVarianceShares | null;
  fit_beta_to_spy?: number | null;
  fit_capm_r2?: number | null;
  fit_nav_correlation?: number | null;
  fit_residual_vol?: number | null;
  fit_nav_vol_ann?: number | null;
  fit_alpha_ann?: number | null;
  fit_erm3_multifactor_r2?: number | null;
  fit_n_months?: number | null;
}

/** v4 cascade variance shares (fractions ~sum to 1; `style` present for v4). */
export interface FundVarianceShares {
  market: number | null;
  sector: number | null;
  subsector: number | null;
  style?: number | null;
  residual: number | null;
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
  "bw_fund_id, series_id, ticker, cik, fund_name, morningstar_category, equity_style_9box, style_link_method, net_expense_ratio, net_expense_ratio_asof, primary_bw_fund_id, latest_report_date, latest_filing_date, latest_extracted_at, latest_total_adj_mv, latest_n_holdings, latest_effective_n, last_in_eligible_universe_at, metadata";

const FUND_LATEST_COLUMNS =
  "bw_fund_id, report_date, filing_date, extracted_at, portfolio_gross_return, portfolio_market_return, portfolio_sector_return, portfolio_subsector_return, portfolio_style_return, portfolio_idiosyncratic_return, identity_residual, weight_sum, n_holdings_active, effective_n, top10_weight_sum, total_adj_mv, equity_style_9box, n_funds_in_cell_at_report_date, model_version, factor_set_id, last_synced_at, metadata, aum_erm3, coverage_in_erm3, variance_shares_full, variance_shares_recent, fit_beta_to_spy, fit_capm_r2, fit_nav_correlation, fit_residual_vol, fit_nav_vol_ann, fit_alpha_ann, fit_erm3_multifactor_r2, fit_n_months";

/**
 * True when `public.funds.latest_total_adj_mv` is missing or non-finite or exactly 0.
 * In those cases we coalesce from `funds_latest.total_adj_mv` so search/detail match
 * the hot-cache row (registry denormalization can lag ds_ph sums).
 */
function registryMvNeedsCoalesce(mv: number | null | undefined): boolean {
  if (mv == null) return true;
  if (!Number.isFinite(mv)) return true;
  return mv === 0;
}

/**
 * Merge registry (`funds`) summary fields from `funds_latest` when the registry
 * value is null/0/non-finite but the latest row has a usable value.
 */
export function mergeFundRegistryWithLatest(
  fund: FundRow,
  latest: FundLatestRow | null | undefined,
): FundRow {
  if (!latest) return fund;

  const out: FundRow = { ...fund };
  const t = latest.total_adj_mv;
  if (
    registryMvNeedsCoalesce(fund.latest_total_adj_mv) &&
    t != null &&
    Number.isFinite(t) &&
    t !== 0
  ) {
    out.latest_total_adj_mv = t;
  }

  if (
    (fund.latest_n_holdings == null || fund.latest_n_holdings === 0) &&
    latest.n_holdings_active != null &&
    latest.n_holdings_active > 0
  ) {
    out.latest_n_holdings = latest.n_holdings_active;
  }

  const eff = latest.effective_n;
  if (
    (fund.latest_effective_n == null || fund.latest_effective_n === 0) &&
    eff != null &&
    Number.isFinite(eff) &&
    eff !== 0
  ) {
    out.latest_effective_n = eff;
  }

  return out;
}

async function fetchFundRegistryRow(
  bwFundId: string,
): Promise<FundRow | null> {
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

/** Registry row + `funds_latest` coalesced fields (single-fund reads). */
export async function fetchFund(bwFundId: string): Promise<FundRow | null> {
  const resolved = await resolveFundById(bwFundId);
  return resolved?.fund ?? null;
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
    fetchFundRegistryRow(bwFundId),
    fetchFundLatest(bwFundId),
  ]);
  if (!fund) return null;
  return { fund: mergeFundRegistryWithLatest(fund, latest), latest };
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
      const latest = latestById.get(fund.bw_fund_id) ?? null;
      result.set(fund.bw_fund_id, {
        fund: mergeFundRegistryWithLatest(fund, latest),
        latest,
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
    const rows = (data ?? []) as FundRow[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.bw_fund_id);
    const { data: latestData, error: latestErr } = await admin
      .from("funds_latest")
      .select(FUND_LATEST_COLUMNS)
      .in("bw_fund_id", ids);
    if (latestErr) {
      console.error("[Funds DAL] searchFunds funds_latest batch error:", latestErr);
      return rows;
    }
    const latestById = new Map<string, FundLatestRow>();
    for (const row of (latestData ?? []) as FundLatestRow[]) {
      latestById.set(row.bw_fund_id, row);
    }
    return rows.map((fund) =>
      mergeFundRegistryWithLatest(fund, latestById.get(fund.bw_fund_id)),
    );
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
  /** v4 cascade (D.8.38): size+value style increment, diagnostic. */
  portfolio_style_return: number | null;
  /** v4 cascade (D.8.38): stock-specific residual, net of style. */
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
  "equity_style_9box, weighting, report_date, filing_date_max, extracted_at, portfolio_gross_return, portfolio_market_return, portfolio_sector_return, portfolio_subsector_return, portfolio_style_return, portfolio_idiosyncratic_return, identity_residual, weight_sum, n_holdings_active, effective_n, top10_weight_sum, n_funds_in_cell, model_version, last_synced_at, metadata";

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
 * All rank entries for one fund within its 9-box cell. Reads
 * `style_rankings_top` filtered to `cohort_type='fund'` and
 * `entity_id=bw_fund_id`. One row per (metric, period_window). Returns
 * [] if the fund isn't in the cohort or has no rank coverage yet.
 */
export async function fetchFundCohortRanks(
  bwFundId: string,
): Promise<StyleRankingRow[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("style_rankings_top")
      .select(STYLE_RANKING_COLUMNS)
      .eq("cohort_type", "fund")
      .eq("entity_id", bwFundId)
      .order("metric", { ascending: true })
      .order("period_window", { ascending: true });
    if (error) {
      console.error("[Funds DAL] fetchFundCohortRanks error:", error);
      return [];
    }
    return (data ?? []) as StyleRankingRow[];
  } catch (error) {
    console.error("[Funds DAL] fetchFundCohortRanks error:", error);
    return [];
  }
}

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
