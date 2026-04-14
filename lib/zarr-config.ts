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

export function zarrReturnsBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_returns_${factorSetId}.zarr`;
}

export function zarrHedgeBasename(factorSetId = getZarrFactorSetId()): string {
  return `ds_erm3_hedge_weights_${factorSetId}.zarr`;
}
