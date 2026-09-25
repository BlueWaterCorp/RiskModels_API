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
  | "hedge_ratio"
  | "explained_risk"
  | "returns_decomposition"
  | "lstar"
  | "residual_signal"
  | "cohort";

/** ISO dates (inclusive). Products absent here have no floor beyond store coverage. */
export const SERVED_HISTORY_START: Readonly<Record<ServedProduct, string>> = {
  market_cap: "2013-06-27",
  hedge_ratio: "2014-06-26",
  explained_risk: "2015-06-26",
  returns_decomposition: "2015-06-26",
  lstar: "2015-06-26",
  residual_signal: "2015-06-26",
  cohort: "2015-06-26",
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
