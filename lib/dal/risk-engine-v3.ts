/**
 * ERM3 V3 Risk Engine DAL — Supabase + GCS Zarr for RiskModels_API
 *
 * Range history for standard daily metrics is read from consolidated Zarr; Supabase
 * backs latest tables, rankings, monthly keys, and EAV fallbacks. See
 * docs/API_HISTORY_SUPABASE_AND_ZARR.md.
 *
 * See: docs/supabase/V3_DATA_CONTRACT.md
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { readHistorySlice } from "@/lib/dal/zarr-reader";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  getZarrSpec,
  isRankingMetricKey,
  ZARR_UNSUPPORTED_DAILY_KEYS,
} from "@/lib/dal/zarr-metric-registry";

/** Calendar lookback for Zarr-backed `fetchLatestMetrics` (avoids scanning full teo axis). */
const ZARR_LATEST_METRICS_LOOKBACK_DAYS = 400;

// V3 Metric Dictionary (ground truth from V3_DATA_CONTRACT.md)
export type V3MetricKey =
  | "returns_gross"
  | "vol_23d"
  | "price_close"
  | "market_cap"
  | "stock_var"
  | "l1_mkt_hr"
  | "l1_mkt_er"
  | "l1_res_er"
  | "l1_cfr"
  | "l1_rr"
  | "l2_mkt_hr"
  | "l2_sec_hr"
  | "l2_mkt_er"
  | "l2_sec_er"
  | "l2_res_er"
  | "l2_cfr"
  | "l2_rr"
  | "l3_mkt_hr"
  | "l3_sec_hr"
  | "l3_sub_hr"
  | "l3_mkt_er"
  | "l3_sec_er"
  | "l3_sub_er"
  | "l3_res_er"
  | "l3_cfr"
  | "l3_rr"
  | "l1_mkt_beta"
  | "l2_sec_beta"
  | "l3_sub_beta";

export type V3Periodicity = "daily" | "monthly";

// V3 Row shape from security_history
export interface SecurityHistoryRow {
  symbol: string;
  teo: string;
  periodicity: V3Periodicity;
  metric_key: V3MetricKey;
  metric_value: number | null;
}

// Symbol registry row from public.symbols
export interface SymbolRegistryRow {
  symbol: string;
  ticker: string;
  name: string | null;
  asset_type: string | null;
  sector_etf: string | null;
  subsector_etf: string | null;
  is_adr: boolean | null;
  isin: string | null;
}

// Fetch options
export interface FetchHistoryOptions {
  periodicity?: V3Periodicity;
  startDate?: string;
  endDate?: string;
  orderBy?: "asc" | "desc";
}

/** Which store served `fetchHistoryWithSource` (for `_metadata.data_source`). */
export type HistoryDataSource = "zarr" | "supabase";

// Pivoted result for convenience (wide format)
export interface PivotedHistoryRow {
  teo: string;
  [key: string]: number | string | null;
}

// Latest summary row from security_history_latest (pipeline-maintained)
export interface LatestSummaryRow {
  symbol: string;
  periodicity: string;
  teo: string;
  returns_gross: number | null;
  vol_23d: number | null;
  price_close: number | null;
  market_cap: number | null;
  l1_mkt_hr: number | null;
  l1_mkt_er: number | null;
  l1_res_er: number | null;
  l1_cfr?: number | null;
  l1_rr?: number | null;
  l2_mkt_hr: number | null;
  l2_sec_hr: number | null;
  l2_mkt_er: number | null;
  l2_sec_er: number | null;
  l2_res_er: number | null;
  l2_cfr?: number | null;
  l2_rr?: number | null;
  l3_mkt_hr: number | null;
  l3_sec_hr: number | null;
  l3_sub_hr: number | null;
  l3_mkt_er: number | null;
  l3_sec_er: number | null;
  l3_sub_er: number | null;
  l3_res_er: number | null;
  l3_cfr?: number | null;
  l3_rr?: number | null;
  stock_var: number | null;
  // Hierarchical regression betas (one per level — see OPENAPI_SPEC.yaml MetricsV3)
  l1_mkt_beta?: number | null;
  l2_sec_beta?: number | null;
  l3_sub_beta?: number | null;
  updated_at: string | null;
}

export interface RankingResult {
  metric: string;
  cohort: string;
  window: string;
  rank_ordinal: number | null;
  cohort_size: number | null;
  rank_percentile: number | null;
}

/** V3 ranking constants */
export const RANKING_WINDOWS = ["1d", "21d", "63d", "252d"] as const;
export const RANKING_COHORTS = ["universe", "sector", "subsector"] as const;
export const RANKING_METRICS = [
  "mkt_cap",
  "gross_return",
  "sector_residual",
  "subsector_residual",
  "er_l1",
  "er_l2",
  "er_l3",
] as const;

/**
 * Ticker aliases for resolution fallback (e.g. symbols has GOOG but user requests GOOGL).
 */
const TICKER_ALIASES: Record<string, string[]> = {
  GOOGL: ["GOOG"],
  GOOG: ["GOOGL"],
};

/**
 * Normalize symbol row: fall back to metadata JSONB for name/sector_etf when top-level columns are null.
 */
function normalizeSymbolRow(row: Record<string, unknown> | null): SymbolRegistryRow | null {
  if (!row) return null;
  const metadata = (row.metadata as Record<string, unknown>) ?? {};
  return {
    symbol: row.symbol as string,
    ticker: row.ticker as string,
    name: (row.name as string | null) ?? (metadata.company_name as string | null) ?? null,
    asset_type: row.asset_type as string | null,
    sector_etf: (row.sector_etf as string | null) ?? (metadata.sector_etf as string | null) ?? null,
    subsector_etf: row.subsector_etf as string | null,
    is_adr: row.is_adr as boolean | null,
    isin: row.isin as string | null,
  };
}

// ---------------------------------------------------------------------------
// Symbol resolution
// ---------------------------------------------------------------------------

export async function resolveSymbolByTicker(
  ticker: string,
): Promise<SymbolRegistryRow | null> {
  const upper = ticker.toUpperCase();

  const tryResolve = async (t: string): Promise<SymbolRegistryRow | null> => {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("symbols")
        .select("symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, isin, metadata")
        .eq("ticker", t)
        .maybeSingle();
      if (error) {
        console.error(`[V3 DAL] Error resolving ticker ${t}:`, error);
        return null;
      }
      return normalizeSymbolRow(data as Record<string, unknown> | null);
    } catch (error) {
      console.error(`[V3 DAL] Error resolving ticker ${t}:`, error);
      return null;
    }
  };

  let result = await tryResolve(upper);
  if (result) return result;

  const aliases = TICKER_ALIASES[upper];
  if (aliases) {
    for (const alias of aliases) {
      result = await tryResolve(alias);
      if (result) {
        return { ...result, ticker: upper };
      }
    }
  }

  return null;
}

export async function resolveSymbolsByTickers(
  tickers: string[],
): Promise<Map<string, SymbolRegistryRow>> {
  const upperTickers = tickers.map(t => t.toUpperCase());
  const result = new Map<string, SymbolRegistryRow>();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("symbols")
      .select("symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, isin, metadata")
      .in("ticker", upperTickers);

    if (error) {
      console.error("[V3 DAL] Error batch resolving tickers:", error);
      return result;
    }

    for (const row of data ?? []) {
      const normalized = normalizeSymbolRow(row as Record<string, unknown>);
      if (normalized) {
        const requestedKey = upperTickers.find(ut => ut === normalized.ticker) ?? normalized.ticker;
        result.set(requestedKey, normalized);
      }
    }

    // Alias fallback for missing tickers
    const missing = upperTickers.filter(t => !result.has(t));
    if (missing.length === 0) return result;

    const allAliases = new Set<string>();
    const aliasToRequested = new Map<string, string>();
    for (const requested of missing) {
      const aliases = TICKER_ALIASES[requested];
      if (aliases) {
        for (const alias of aliases) {
          allAliases.add(alias);
          if (!aliasToRequested.has(alias)) aliasToRequested.set(alias, requested);
        }
      }
    }

    if (allAliases.size === 0) return result;

    const { data: aliasData } = await admin
      .from("symbols")
      .select("symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, isin, metadata")
      .in("ticker", Array.from(allAliases));

    for (const row of aliasData ?? []) {
      const normalized = normalizeSymbolRow(row as Record<string, unknown>);
      if (normalized) {
        const requested = aliasToRequested.get(normalized.ticker);
        if (requested && !result.has(requested)) {
          result.set(requested, { ...normalized, ticker: requested });
        }
      }
    }

    return result;
  } catch (error) {
    console.error("[V3 DAL] Error batch resolving tickers:", error);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Security history
// ---------------------------------------------------------------------------

/** True when `fetchHistory` / `fetchBatchHistory` read daily metrics from GCS Zarr. */
export function isZarrHistoryPath(keys: V3MetricKey[], periodicity: V3Periodicity): boolean {
  if (periodicity !== "daily") return false;
  for (const k of keys) {
    if (ZARR_UNSUPPORTED_DAILY_KEYS.has(k)) return false;
    if (isRankingMetricKey(k as string)) return false;
    if (!getZarrSpec(k)) return false;
  }
  return keys.length > 0;
}

/** Supabase EAV history (rankings, monthly betas, unknown keys). */
async function fetchHistoryFromSupabase(
  symbol: string,
  keys: V3MetricKey[],
  options: FetchHistoryOptions = {},
): Promise<SecurityHistoryRow[]> {
  const {
    periodicity = "daily",
    startDate,
    endDate,
    orderBy = "asc",
  } = options;

  try {
    const admin = createAdminClient();
    let query = admin
      .from("security_history")
      .select("symbol, teo, periodicity, metric_key, metric_value")
      .eq("symbol", symbol)
      .eq("periodicity", periodicity)
      .in("metric_key", keys)
      .order("teo", { ascending: orderBy === "asc" });

    if (startDate) query = query.gte("teo", startDate);
    if (endDate) query = query.lte("teo", endDate);

    const { data, error } = await query;
    if (error) {
      console.error(`[V3 DAL] Error fetching history for ${symbol}:`, error);
      return [];
    }
    return (data ?? []) as SecurityHistoryRow[];
  } catch (error) {
    console.error(`[V3 DAL] Error fetching history for ${symbol}:`, error);
    return [];
  }
}

async function fetchBatchHistoryFromSupabase(
  symbols: string[],
  keys: V3MetricKey[],
  options: FetchHistoryOptions = {},
): Promise<SecurityHistoryRow[]> {
  const {
    periodicity = "daily",
    startDate,
    endDate,
    orderBy = "asc",
  } = options;

  if (symbols.length === 0) return [];

  try {
    const admin = createAdminClient();
    let query = admin
      .from("security_history")
      .select("symbol, teo, periodicity, metric_key, metric_value")
      .in("symbol", symbols)
      .eq("periodicity", periodicity)
      .in("metric_key", keys)
      .order("teo", { ascending: orderBy === "asc" });

    if (startDate) query = query.gte("teo", startDate);
    if (endDate) query = query.lte("teo", endDate);

    const { data, error } = await query;
    if (error) {
      console.error("[V3 DAL] Error fetching batch history:", error);
      return [];
    }
    return (data ?? []) as SecurityHistoryRow[];
  } catch (error) {
    console.error("[V3 DAL] Error fetching batch history:", error);
    return [];
  }
}

/**
 * Same as `fetchHistory` but reports whether rows came from Zarr or Supabase `security_history`.
 * Use when API responses must set accurate `_metadata.data_source`.
 */
export async function fetchHistoryWithSource(
  symbol: string,
  keys: V3MetricKey[],
  options: FetchHistoryOptions = {},
): Promise<{ rows: SecurityHistoryRow[]; dataSource: HistoryDataSource }> {
  const {
    periodicity = "daily",
    startDate,
    endDate,
    orderBy = "asc",
  } = options;

  if (isZarrHistoryPath(keys, periodicity)) {
    // Zarr is the only store for range-based daily V3 metric history
    // (see docs/API_HISTORY_SUPABASE_AND_ZARR.md). No Supabase fallback:
    // security_history does not carry these metric_keys, so a fallback query
    // would always return []-after-12-25s and silently serve empty success.
    // On zarr error, let the exception propagate to the route handler.
    const { rows } = await readHistorySlice({
      symbols: [symbol],
      keys,
      periodicity,
      startDate,
      endDate,
      orderBy,
    });
    if (rows.length === 0) {
      console.warn("[V3 DAL] Zarr history returned empty rows", { symbol, keyCount: keys.length });
    }
    return { rows, dataSource: "zarr" };
  }

  const rows = await fetchHistoryFromSupabase(symbol, keys, options);
  return { rows, dataSource: "supabase" };
}

/** Daily factor history: consolidated Zarr on GCS (see docs/API_HISTORY_SUPABASE_AND_ZARR.md). */
export async function fetchHistory(
  symbol: string,
  keys: V3MetricKey[],
  options: FetchHistoryOptions = {},
): Promise<SecurityHistoryRow[]> {
  const { rows } = await fetchHistoryWithSource(symbol, keys, options);
  return rows;
}

export async function fetchBatchHistory(
  symbols: string[],
  keys: V3MetricKey[],
  options: FetchHistoryOptions = {},
): Promise<SecurityHistoryRow[]> {
  const {
    periodicity = "daily",
    startDate,
    endDate,
    orderBy = "asc",
  } = options;

  if (symbols.length === 0) return [];

  if (isZarrHistoryPath(keys, periodicity)) {
    // See fetchHistoryWithSource — zarr is authoritative for V3 metric history.
    const { rows } = await readHistorySlice({
      symbols,
      keys,
      periodicity,
      startDate,
      endDate,
      orderBy,
    });
    if (rows.length === 0) {
      console.warn("[V3 DAL] Zarr batch history returned empty rows", {
        symbolCount: symbols.length,
        keyCount: keys.length,
      });
    }
    return rows;
  }

  return fetchBatchHistoryFromSupabase(symbols, keys, options);
}

// ---------------------------------------------------------------------------
// security_history_latest (fast path)
// ---------------------------------------------------------------------------

export async function fetchLatestSummary(
  symbol: string,
  periodicity: V3Periodicity = "daily",
): Promise<{ teo: string; metrics: Record<string, number | null> } | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("security_history_latest")
      .select("*")
      .eq("symbol", symbol)
      .eq("periodicity", periodicity)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as LatestSummaryRow;
    return {
      teo: row.teo,
      metrics: {
        returns_gross: row.returns_gross,
        vol_23d: row.vol_23d,
        price_close: row.price_close,
        market_cap: row.market_cap,
        l1_mkt_hr: row.l1_mkt_hr,
        l1_mkt_er: row.l1_mkt_er,
        l1_res_er: row.l1_res_er,
        l1_cfr: row.l1_cfr ?? null,
        l1_rr: row.l1_rr ?? null,
        l2_mkt_hr: row.l2_mkt_hr,
        l2_sec_hr: row.l2_sec_hr,
        l2_mkt_er: row.l2_mkt_er,
        l2_sec_er: row.l2_sec_er,
        l2_res_er: row.l2_res_er,
        l2_cfr: row.l2_cfr ?? null,
        l2_rr: row.l2_rr ?? null,
        l3_mkt_hr: row.l3_mkt_hr,
        l3_sec_hr: row.l3_sec_hr,
        l3_sub_hr: row.l3_sub_hr,
        l3_mkt_er: row.l3_mkt_er,
        l3_sec_er: row.l3_sec_er,
        l3_sub_er: row.l3_sub_er,
        l3_res_er: row.l3_res_er,
        l3_cfr: row.l3_cfr ?? null,
        l3_rr: row.l3_rr ?? null,
        stock_var: row.stock_var,
        l1_mkt_beta: row.l1_mkt_beta ?? null,
        l2_sec_beta: row.l2_sec_beta ?? null,
        l3_sub_beta: row.l3_sub_beta ?? null,
      },
    };
  } catch (error) {
    console.error(`[V3 DAL] Error fetching latest summary for ${symbol}:`, error);
    return null;
  }
}

export async function fetchBatchLatestSummary(
  symbols: string[],
  periodicity: V3Periodicity = "daily",
): Promise<Map<string, { teo: string; metrics: Record<string, number | null> }>> {
  if (symbols.length === 0) return new Map();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("security_history_latest")
      .select("*")
      .in("symbol", symbols)
      .eq("periodicity", periodicity);

    if (error) {
      console.error("[V3 DAL] Error fetching batch latest summary:", error);
      return new Map();
    }

    const result = new Map<string, { teo: string; metrics: Record<string, number | null> }>();
    for (const row of (data ?? []) as LatestSummaryRow[]) {
      result.set(row.symbol, {
        teo: row.teo,
        metrics: {
          returns_gross: row.returns_gross,
          vol_23d: row.vol_23d,
          price_close: row.price_close,
          market_cap: row.market_cap,
          l1_mkt_hr: row.l1_mkt_hr,
          l1_mkt_er: row.l1_mkt_er,
          l1_res_er: row.l1_res_er,
          l1_cfr: row.l1_cfr ?? null,
          l1_rr: row.l1_rr ?? null,
          l2_mkt_hr: row.l2_mkt_hr,
          l2_sec_hr: row.l2_sec_hr,
          l2_mkt_er: row.l2_mkt_er,
          l2_sec_er: row.l2_sec_er,
          l2_res_er: row.l2_res_er,
          l2_cfr: row.l2_cfr ?? null,
          l2_rr: row.l2_rr ?? null,
          l3_mkt_hr: row.l3_mkt_hr,
          l3_sec_hr: row.l3_sec_hr,
          l3_sub_hr: row.l3_sub_hr,
          l3_mkt_er: row.l3_mkt_er,
          l3_sec_er: row.l3_sec_er,
          l3_sub_er: row.l3_sub_er,
          l3_res_er: row.l3_res_er,
          l3_cfr: row.l3_cfr ?? null,
          l3_rr: row.l3_rr ?? null,
          stock_var: row.stock_var,
          l1_mkt_beta: row.l1_mkt_beta ?? null,
          l2_sec_beta: row.l2_sec_beta ?? null,
          l3_sub_beta: row.l3_sub_beta ?? null,
        },
      });
    }
    return result;
  } catch (error) {
    console.error("[V3 DAL] Error fetching batch latest summary:", error);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Latest metrics when `security_history_latest` is unavailable (EAV tail read)
// ---------------------------------------------------------------------------

export async function fetchLatestMetrics(
  symbol: string,
  keys: V3MetricKey[],
  periodicity: V3Periodicity = "daily",
): Promise<{ teo: string; metrics: Record<string, number | null> } | null> {
  try {
    const options: FetchHistoryOptions = {
      periodicity,
      orderBy: "desc",
    };
    if (isZarrHistoryPath(keys, periodicity)) {
      const meta = await getRiskMetadata();
      const end = meta.data_as_of;
      const start = new Date(`${end}T12:00:00Z`);
      start.setUTCDate(start.getUTCDate() - ZARR_LATEST_METRICS_LOOKBACK_DAYS);
      options.startDate = start.toISOString().slice(0, 10);
      options.endDate = end;
    }

    const data = await fetchHistory(symbol, keys, options);

    if (!data || data.length === 0) return null;

    const byDate = new Map<string, Map<string, number | null>>();
    for (const row of data) {
      if (!byDate.has(row.teo)) byDate.set(row.teo, new Map());
      byDate.get(row.teo)!.set(row.metric_key, row.metric_value);
    }

    const sortedDates = Array.from(byDate.keys()).sort().reverse();

    for (const date of sortedDates) {
      const metricsMap = byDate.get(date)!;
      if (keys.every(k => metricsMap.has(k))) {
        return { teo: date, metrics: Object.fromEntries(metricsMap.entries()) };
      }
    }

    const mostRecentDate = sortedDates[0];
    const metricsMap = byDate.get(mostRecentDate)!;
    return { teo: mostRecentDate, metrics: Object.fromEntries(metricsMap.entries()) };
  } catch (error) {
    console.error(`[V3 DAL] Error fetching latest metrics for ${symbol}:`, error);
    return null;
  }
}

export async function fetchLatestMetricsWithFallback(
  symbol: string,
  keys: V3MetricKey[],
  periodicity: V3Periodicity = "daily",
): Promise<{ teo: string; metrics: Record<string, number | null> } | null> {
  const fromLatest = await fetchLatestSummary(symbol, periodicity);
  if (fromLatest) {
    const filtered: Record<string, number | null> = {};
    for (const k of keys) {
      filtered[k] = fromLatest.metrics[k] ?? null;
    }
    return { teo: fromLatest.teo, metrics: filtered };
  }
  return fetchLatestMetrics(symbol, keys, periodicity);
}

// ---------------------------------------------------------------------------
// Trading calendar
// ---------------------------------------------------------------------------

export async function fetchTradingCalendar(
  periodicity: V3Periodicity = "daily",
): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("trading_calendar")
      .select("teo")
      .eq("periodicity", periodicity)
      .order("teo", { ascending: true });

    if (error) {
      console.error("[V3 DAL] Error fetching trading calendar:", error);
      return [];
    }
    return (data ?? []).map((r: { teo: string }) => r.teo);
  } catch (error) {
    console.error("[V3 DAL] Error fetching trading calendar:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export async function fetchRankingsFromSecurityHistory(
  symbol: string,
  filters?: { metric?: string; cohort?: string; window?: string },
): Promise<{ teo: string | null; rankings: RankingResult[] }> {
  const windows = filters?.window ? [filters.window] : [...RANKING_WINDOWS];
  const cohorts = filters?.cohort ? [filters.cohort] : [...RANKING_COHORTS];
  const metrics = filters?.metric ? [filters.metric] : [...RANKING_METRICS];

  const keys: string[] = [];
  for (const w of windows) {
    for (const c of cohorts) {
      for (const m of metrics) {
        const prefix = `${w}_${c}_${m}`;
        keys.push(`rank_ord_${prefix}`);
        keys.push(`cohort_size_${prefix}`);
      }
    }
  }

  try {
    const data = await fetchHistoryFromSupabase(symbol, keys as V3MetricKey[], {
      periodicity: "daily",
      orderBy: "desc",
    });

    if (!data || data.length === 0) return { teo: null, rankings: [] };

    const byTeo = new Map<string, Map<string, number | null>>();
    for (const row of data) {
      if (!byTeo.has(row.teo)) byTeo.set(row.teo, new Map());
      byTeo.get(row.teo)!.set(row.metric_key, row.metric_value);
    }

    const sortedTeos = Array.from(byTeo.keys()).sort().reverse();
    const latestTeo = sortedTeos[0];
    const latestMap = byTeo.get(latestTeo)!;

    const rankings: RankingResult[] = [];
    for (const w of windows) {
      for (const c of cohorts) {
        for (const m of metrics) {
          const prefix = `${w}_${c}_${m}`;
          const rankOrd = latestMap.get(`rank_ord_${prefix}`);
          const cohortSize = latestMap.get(`cohort_size_${prefix}`);

          const rankOrdinal =
            rankOrd != null && typeof rankOrd === "number" && rankOrd >= 1
              ? Math.round(rankOrd)
              : null;
          const cohortSizeVal =
            cohortSize != null && typeof cohortSize === "number" && cohortSize > 0
              ? Math.round(cohortSize)
              : null;
          const rankPercentile =
            rankOrdinal != null && cohortSizeVal != null && cohortSizeVal > 0
              ? (1 - (rankOrdinal - 1) / cohortSizeVal) * 100
              : null;

          rankings.push({ metric: m, cohort: c, window: w, rank_ordinal: rankOrdinal, cohort_size: cohortSizeVal, rank_percentile: rankPercentile });
        }
      }
    }

    return { teo: latestTeo, rankings };
  } catch (error) {
    console.error(`[V3 DAL] Error fetching rankings for ${symbol}:`, error);
    return { teo: null, rankings: [] };
  }
}

/** One row for GET /rankings/top (best rank ordinal first). */
export interface TopRankingRow {
  symbol: string;
  ticker: string;
  rank_ordinal: number;
  cohort_size: number | null;
  rank_percentile: number | null;
}

/**
 * Cross-sectional leaderboard: symbols with lowest rank_ordinal at latest `teo` for
 * `rank_ord_{window}_{cohort}_{metric}` (rank 1 = best; percentile 100 = best).
 */
export async function fetchTopRankingsSnapshot(params: {
  metric: string;
  cohort: string;
  window: string;
  limit: number;
}): Promise<{ teo: string | null; rows: TopRankingRow[] }> {
  const { metric, cohort, window, limit } = params;
  const cap = Math.min(100, Math.max(1, Math.floor(limit)));
  const prefix = `${window}_${cohort}_${metric}`;
  const rankKey = `rank_ord_${prefix}` as V3MetricKey;
  const cohortKey = `cohort_size_${prefix}` as V3MetricKey;

  try {
    const admin = createAdminClient();
    const { data: teoRow, error: teoErr } = await admin
      .from("security_history")
      .select("teo")
      .eq("metric_key", rankKey)
      .eq("periodicity", "daily")
      .order("teo", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (teoErr || !teoRow?.teo) {
      return { teo: null, rows: [] };
    }
    const teo = teoRow.teo as string;

    const { data: rankRows, error: rankErr } = await admin
      .from("security_history")
      .select("symbol, metric_value")
      .eq("metric_key", rankKey)
      .eq("periodicity", "daily")
      .eq("teo", teo)
      .not("metric_value", "is", null)
      .order("metric_value", { ascending: true })
      .limit(cap);

    if (rankErr || !rankRows?.length) {
      return { teo, rows: [] };
    }

    const symbols = [...new Set(rankRows.map((r: { symbol: string }) => r.symbol))];

    const { data: cohortRows } = await admin
      .from("security_history")
      .select("symbol, metric_value")
      .eq("metric_key", cohortKey)
      .eq("periodicity", "daily")
      .eq("teo", teo)
      .in("symbol", symbols);

    const cohortBySymbol = new Map<string, number | null>();
    for (const r of cohortRows ?? []) {
      const sym = (r as { symbol: string }).symbol;
      const mv = (r as { metric_value: number | null }).metric_value;
      cohortBySymbol.set(
        sym,
        mv != null && typeof mv === "number" ? Math.round(mv) : null,
      );
    }

    const { data: symRows } = await admin
      .from("symbols")
      .select("symbol, ticker")
      .in("symbol", symbols);

    const tickerBySymbol = new Map<string, string>();
    for (const r of symRows ?? []) {
      tickerBySymbol.set(
        (r as { symbol: string; ticker: string }).symbol,
        (r as { symbol: string; ticker: string }).ticker,
      );
    }

    const rows: TopRankingRow[] = [];
    for (const r of rankRows as { symbol: string; metric_value: number }[]) {
      const rankOrdinal =
        r.metric_value != null && typeof r.metric_value === "number"
          ? Math.round(r.metric_value)
          : null;
      if (rankOrdinal == null || rankOrdinal < 1) continue;

      const cohortSizeVal = cohortBySymbol.get(r.symbol) ?? null;
      const rankPercentile =
        cohortSizeVal != null && cohortSizeVal > 0
          ? (1 - (rankOrdinal - 1) / cohortSizeVal) * 100
          : null;

      rows.push({
        symbol: r.symbol,
        ticker: tickerBySymbol.get(r.symbol) ?? r.symbol,
        rank_ordinal: rankOrdinal,
        cohort_size: cohortSizeVal,
        rank_percentile: rankPercentile,
      });
    }

    return { teo, rows };
  } catch (error) {
    console.error("[V3 DAL] Error fetching top rankings:", error);
    return { teo: null, rows: [] };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (identical to Risk_Models source)
// ---------------------------------------------------------------------------

export function pivotHistory(rows: SecurityHistoryRow[]): PivotedHistoryRow[] {
  const pivot = new Map<string, PivotedHistoryRow>();
  for (const row of rows) {
    if (!pivot.has(row.teo)) pivot.set(row.teo, { teo: row.teo });
    pivot.get(row.teo)![row.metric_key] = row.metric_value;
  }
  return Array.from(pivot.values()).sort((a, b) => a.teo.localeCompare(b.teo));
}

/** Most recent row after `pivotHistory` (pivoted rows are sorted ascending by `teo`). */
export function latestPivotedRow(pivoted: PivotedHistoryRow[]): PivotedHistoryRow | null {
  if (pivoted.length === 0) return null;
  return pivoted[pivoted.length - 1];
}

export function extractMetric(row: PivotedHistoryRow, key: V3MetricKey): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}
