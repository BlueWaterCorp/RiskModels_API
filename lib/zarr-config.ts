/**
 * Internal Zarr / GCS layout (never expose bucket paths or filenames in API responses).
 *
 * Env:
 * - ZARR_GCS_PREFIX — default "rm_api_data/eodhd" → bucket "rm_api_data", object base "eodhd"
 * - ZARR_FACTOR_SET_ID — default "SPY_uni_mc_3000" (matches ds_*_{id}.zarr suffix)
 */

const DEFAULT_PREFIX = "rm_api_data/eodhd";
const DEFAULT_FACTOR_SET = "SPY_uni_mc_3000";

export function getZarrFactorSetId(): string {
  return (process.env.ZARR_FACTOR_SET_ID ?? DEFAULT_FACTOR_SET).trim();
}

/** Split "bucket/basePath" for @google-cloud/storage (internal only). */
export function parseZarrGcsPrefix(): { bucket: string; basePath: string } {
  const raw = (process.env.ZARR_GCS_PREFIX ?? DEFAULT_PREFIX).trim();
  const i = raw.indexOf("/");
  if (i <= 0) {
    return { bucket: raw || "rm_api_data", basePath: "" };
  }
  return { bucket: raw.slice(0, i), basePath: raw.slice(i + 1).replace(/\/$/, "") };
}

/** Basename only (no bucket / gs prefix). */
export function zarrDailyBasename(): string {
  return "ds_daily.zarr";
}

/** ETF store — disjoint roster from ds_daily (~100 ETFs with their own symbol IDs). */
export function zarrEtfBasename(): string {
  return "ds_etf.zarr";
}

/**
 * Mask store — universe membership masks + per-day validity, dual-axis aligned
 * with ds_daily. One zarr per pipeline (not per-factor-set). Backs the
 * `/api/universe/{name}/members` endpoint and the upstream mask gates that
 * keep ds_erm3_* zarrs clean.
 */
export function zarrMasksBasename(): string {
  return "ds_masks.zarr";
}

export function zarrReturnsBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_returns_${factorSetId}.zarr`;
}

export function zarrHedgeBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_hedge_weights_${factorSetId}.zarr`;
}

/**
 * Rankings store: flat (teo, symbol) layout with one variable per
 * (window, cohort, metric) combo, named exactly like the legacy Supabase
 * EAV `metric_key` (`rank_ord_*` and `cohort_size_*`). Chunked
 * {teo: 1, symbol: -1} so a "top-K at latest teo" read touches exactly
 * one chunk per variable.
 */
export function zarrRankingsBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_rankings_${factorSetId}.zarr`;
}

/**
 * Residual mean-reversion signal store (Phase D). Per-(teo, symbol) factor
 * served at /api/residual-signal: residual_z_5d, signal_strength, decile_rank,
 * industry_percentile, residual_autocorr_5d, l3_subsector_er,
 * signal_quality_quintile. Carries a `ticker` string coord for in-zarr
 * ticker resolution (no Supabase round-trip needed).
 */
export function zarrResidualSignalBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_residual_signal_${factorSetId}.zarr`;
}

/**
 * ETF-to-ETF link betas (sector→market, subsector→market, subsector→sector).
 * Indexed (teo, symbol) over ~51 ETFs. The cascade hedge basket reads three
 * cells per ticker (sector ETF + subsector ETF at the latest teo).
 *
 * Factor-set agnostic — link betas are SPY-rooted right now, so the basename
 * uses the market_factor_etf, not the universe.
 */
export function zarrLinkBetasBasename(marketFactorEtf = "SPY"): string {
  return `ds_erm3_link_betas_${marketFactorEtf}.zarr`;
}

/**
 * Quarterly fundamentals panel — (symbol, period_end_date) with a separate
 * filed_date PIT stamp. INTERNAL store (EODHD-primary line items). The API
 * serves derived analytics plus raw line items ONLY for cells whose serving
 * value is SEC XBRL (exposed in sec_facts); vendor-sourced raw planes never
 * leave the DAL. See lib/api/fundamentals-contract.ts for the response allowlist.
 */
export function zarrFundamentalsBasename(): string {
  return "ds_fundamentals.zarr";
}

/**
 * Industry peer β panel — Vasicek stats at (teo × fs_industry_code × level).
 * Basename uses the same factor-set suffix as returns/rankings
 * (e.g. ds_erm3_industry_SPY_uni_mc_3000.zarr).
 */
export function zarrIndustryBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_industry_${factorSetId}.zarr`;
}

/**
 * Cohort store (ERM3 H.146) — cross-sectional residual statistics at
 * (teo × cohort), where a cohort is the market (L1), a GICS sector (L2), or a
 * subsector (L3). The first ERM3 artifact published at cohort level rather
 * than per-stock.
 *
 * The statistics are universe-specific: one store per (market factor ETF,
 * universe) pair, and values must never be averaged across universes. ERM3
 * names it `ds_erm3_cohorts_{market_factor_etf}_{universe}.zarr`, which is
 * exactly our factor-set id — that id already folds the two together
 * ("SPY_uni_mc_3000"), so it is passed through whole rather than re-joined.
 *
 * Its headline variable is `residual_mean` — ERM3 fits residuals without an
 * intercept so each stock keeps its alpha, which leaves the cross-sectional
 * mean non-zero. Consumers building relative-ranking signals must demean
 * against it. See lib/dal/cohort-zarr-reader.ts.
 */
export function zarrCohortsBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_cohorts_${factorSetId}.zarr`;
}
