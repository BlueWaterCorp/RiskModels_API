/**
 * Earliest date each data product is served from.
 *
 * A product is served from the first date whose whole estimation window lies
 * inside the data availability window. Requests that start earlier are
 * clamped to this date; nothing before it is returned.
 */

import { getZarrSpec } from "./zarr-metric-registry";

export type ServedProduct =
  | "market_cap"
  | "cost_of_capital"
  | "hedge_ratio"
  | "explained_risk"
  | "returns_decomposition"
  | "lstar"
  | "residual_signal"
  | "cohort";

/** ISO dates (inclusive). Products absent here have no floor beyond store coverage. */
export const SERVED_HISTORY_START: Readonly<Record<ServedProduct, string>> = {
  market_cap: "2009-12-09",
  cost_of_capital: "2014-12-31",
  hedge_ratio: "2010-12-08",
  explained_risk: "2011-12-07",
  returns_decomposition: "2011-12-07",
  lstar: "2011-12-07",
  residual_signal: "2011-12-07",
  cohort: "2011-12-07",
};

/** Product a metric key belongs to, or null when the key has no served-history floor. */
export function servedProductForKey(key: string): ServedProduct | null {
  const spec = getZarrSpec(key as Parameters<typeof getZarrSpec>[0]);
  if (!spec) return null;
  if (spec.role === "daily") return key === "market_cap" ? "market_cap" : null;
  if (spec.role === "returnsFlat") return "lstar";
  if (spec.role === "returns") return "returns_decomposition";
  // hedge store: *_hr are hedge ratios; everything else (ER, variance) is explained risk.
  return /_hr$/.test(key) ? "hedge_ratio" : "explained_risk";
}

/** Latest floor across the requested keys ("" when none applies). */
export function servedHistoryStartForKeys(keys: readonly string[]): string {
  let out = "";
  for (const k of keys) {
    const p = servedProductForKey(k);
    if (p && SERVED_HISTORY_START[p] > out) out = SERVED_HISTORY_START[p];
  }
  return out;
}

/** max(start, floor) on ISO date strings; floor wins when start is absent. */
export function clampStart(start: string | undefined, floor: string): string | undefined {
  if (!floor) return start;
  return !start || start < floor ? floor : start;
}

/**
 * For point-in-time (`as_of`) requests: when `asOf` falls before the floor, the
 * body of a 404 that names the first available date; otherwise null.
 */
export function historyAvailableFromError(
  asOf: string | undefined,
  floor: string,
): { error: string; as_of: string; as_of_basis: "report_date"; history_available_from: string } | null {
  if (!asOf || !floor || asOf >= floor) return null;
  return {
    error: `No data served for as_of=${asOf}: history available from ${floor}`,
    as_of: asOf,
    as_of_basis: "report_date",
    history_available_from: floor,
  };
}
