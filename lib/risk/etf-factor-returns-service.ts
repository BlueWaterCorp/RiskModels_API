/**
 * ETF factor-returns service (R.7).
 *
 * Joins the ds_etf zarr snapshot reader with the public-scope ETF factor
 * classification registry (market + 11 GICS sectors only — see
 * lib/risk/etf-factor-classification.ts for why this scope and no more).
 *
 * Tickers requested outside the public-scope registry are dropped at this
 * layer — the route validator should already reject them with a 400, this is
 * defense-in-depth so the underlying zarr is never probed with an unauthorized
 * ticker even if a future caller path skips the validator.
 */

import {
  ETF_FACTOR_REGISTRY,
  filterFactorRegistry,
  lookupEtfFactorEntry,
  type EtfFactorEntry,
  type EtfSleeve,
} from "@/lib/risk/etf-factor-classification";
import {
  readEtfFactorReturnsSnapshot,
  type EtfFactorReturnRow,
} from "@/lib/dal/zarr-reader";

export interface EtfFactorReturnsServiceParams {
  sleeve?: EtfSleeve | "all";
  tickers?: string[];
  teo?: string;
}

export interface EtfFactorReturnsRowOut extends EtfFactorReturnRow {
  sleeve: EtfSleeve;
  name: string;
}

export interface EtfFactorReturnsResult {
  teo: string;
  filter: { sleeve: EtfSleeve | "all"; tickers: string[] | null };
  windows: readonly string[];
  rows: EtfFactorReturnsRowOut[];
}

/**
 * Resolve the request to the in-scope ETF set, fetch the snapshot, and shape
 * the response with sleeve + display name attached. Returns null when the
 * underlying zarr is unavailable.
 */
export async function getEtfFactorReturns(
  params: EtfFactorReturnsServiceParams = {},
): Promise<EtfFactorReturnsResult | null> {
  const sleeve = params.sleeve ?? "all";

  // Authorized set = registry filtered by sleeve, then optionally intersected
  // with the caller's ticker list. The registry is the authority for what's
  // legal to ask about; the zarr is the authority for what actually has data.
  let scope: EtfFactorEntry[] = filterFactorRegistry(sleeve);
  if (params.tickers && params.tickers.length) {
    const requested = new Set(params.tickers);
    scope = scope.filter((e) => requested.has(e.ticker));
  }
  if (!scope.length) {
    return {
      teo: "",
      filter: { sleeve, tickers: params.tickers ?? null },
      windows: ["1d", "21d", "63d", "252d"],
      rows: [],
    };
  }

  const snap = await readEtfFactorReturnsSnapshot({
    tickers: scope.map((e) => e.ticker),
    teo: params.teo,
  });
  if (!snap) return null;

  const rows: EtfFactorReturnsRowOut[] = snap.rows.map((r) => {
    const entry = lookupEtfFactorEntry(r.ticker);
    // entry is guaranteed non-null because `scope` was built from the registry;
    // ETF_FACTOR_REGISTRY is the fallback to keep the type non-null.
    const e = entry ?? ETF_FACTOR_REGISTRY[0]!;
    return { ...r, sleeve: e.sleeve, name: e.name };
  });

  return {
    teo: snap.teo,
    filter: { sleeve, tickers: params.tickers ?? null },
    windows: ["1d", "21d", "63d", "252d"],
    rows,
  };
}
