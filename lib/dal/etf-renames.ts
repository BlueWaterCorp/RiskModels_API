/**
 * Coordinated ETF ticker renames (ERM3-68; SPLG -> SPYM). One fund, two tickers.
 *
 * ERM3 switches a rename on from a dated cutover (`etf_universe.renames` in its config). From that night it prices
 * the fund under the security master's id with the new ticker and stamps the old published `symbols` row
 * `metadata.superseded_by` / `renamed_to`. The API follows the same day through one env flag per rename,
 * `RM_ETF_RENAME_<KEY>=1` (default off):
 * - a `symbols` row superseded by an active rename counts as dead, so the old ticker falls through to the
 *   historical-ticker alias and resolves to the fund's live row;
 * - the ERM3 register and ETF catalog lookups try the other ticker of the pair, so both tickers keep the
 *   fund's register role and its holdings id (Funds_DAG keeps `BW-ETF-SPLG`).
 * Turning the flag off restores today's behaviour (the synchronized rollback).
 */

export interface EtfRename {
  key: string;
  old: string;
  new: string;
}

export const ETF_RENAMES: readonly EtfRename[] = [{ key: "SPLG_SPYM", old: "SPLG", new: "SPYM" }];

type Env = Record<string, string | undefined>;

export function isEtfRenameActive(key: string, env: Env = process.env): boolean {
  return env[`RM_ETF_RENAME_${key}`] === "1";
}

/** The other ticker of every active rename that includes `ticker`. */
export function etfRenamePartners(ticker: string, env: Env = process.env): string[] {
  const t = (ticker ?? "").trim().toUpperCase();
  const out: string[] = [];
  for (const r of ETF_RENAMES) {
    if (!isEtfRenameActive(r.key, env)) continue;
    if (r.old === t) out.push(r.new);
    else if (r.new === t) out.push(r.old);
  }
  return out;
}

/** The ticker a fund trades under now: the new ticker of an active rename, else the input (upper-cased). */
export function etfCurrentTicker(ticker: string, env: Env = process.env): string {
  const t = (ticker ?? "").trim().toUpperCase();
  for (const r of ETF_RENAMES) if (r.old === t && isEtfRenameActive(r.key, env)) return r.new;
  return t;
}

/** True when ERM3 stamped this `symbols` row superseded by a rename that is active here. */
export function isSupersededByActiveRename(
  metadata: Record<string, unknown> | undefined,
  env: Env = process.env,
): boolean {
  if (!metadata || !metadata.superseded_by) return false;
  const to = String(metadata.renamed_to ?? "").toUpperCase();
  return ETF_RENAMES.some((r) => r.new === to && isEtfRenameActive(r.key, env));
}
