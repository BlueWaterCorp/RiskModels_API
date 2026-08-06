/**
 * Share-class projection for id-first consumers (G.100 / G.101 part 2).
 *
 * Reads `public.security_company_map` — the Supabase mirror of ERM3's
 * point-in-time company/share-class map (H.137). `ds_daily` deliberately
 * carries ONE modelled class per company, so a holding reported in a sibling
 * class (Berkshire's Alphabet Class A, Liberty tracking stocks) has no
 * `security_history_latest` row and no `symbols` row: an id-first lookup has
 * nothing to resolve *to*. This module supplies the missing id→id relation:
 * requested `bw_sym_id` → company → the company's modelled class.
 *
 * PIT CONSTRAINT (the thing G.101 says will get lost): the map's windows are
 * CLOSED intervals — a row is valid at `asOf` when
 * `valid_from <= asOf AND (valid_to IS NULL OR valid_to >= asOf)` — and a
 * 13F holding must resolve at its report_date, not at today, or historical
 * filings silently project onto classes that did not exist yet. Callers pass
 * the snapshot's report date; omitting `asOf` resolves at today (UTC).
 *
 * Substitution is a disclosure, not a convenience (the G.35 doctrine): the
 * projection returns the requested class's own identity alongside the
 * modelled sibling's id so consumers can label the row truthfully.
 *
 * Degradation: until the mirror's first publish lands (BWMACRO #118 +
 * the next qa-gated sync_supabase_1f run), the table is absent/empty; this
 * resolver then returns an empty map and enrichment behaves exactly as it
 * did before. Never throws — logs and returns what resolved.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface ShareClassProjection {
  /** The sibling class actually carrying the modelled return series. */
  modelled_security_id: string;
  /** The requested (held) class's own identity, from its map row. */
  requested_ticker: string | null;
  requested_name: string | null;
  requested_class: string | null;
  /** The modelled sibling's identity, for disclosure copy. */
  modelled_ticker: string | null;
  modelled_class: string | null;
}

interface MapRow {
  bw_sym_id: string;
  company_id: string;
  company_name: string | null;
  ticker: string | null;
  share_class: string | null;
  is_modelled_class: boolean;
  valid_from: string;
  valid_to: string | null;
}

const COLUMNS =
  "bw_sym_id, company_id, company_name, ticker, share_class, is_modelled_class, valid_from, valid_to";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Latest-starting row per key among rows already window-filtered at `asOf`. */
function pickByLatestValidFrom(
  rows: MapRow[],
  key: (r: MapRow) => string,
): Map<string, MapRow> {
  const best = new Map<string, MapRow>();
  for (const row of rows) {
    const k = key(row);
    const prev = best.get(k);
    if (!prev || row.valid_from > prev.valid_from) best.set(k, row);
  }
  return best;
}

/**
 * For each requested `bw_sym_id` that is NOT the modelled class of its
 * company at `asOf`, return the projection onto the class that is. Modelled
 * ids and ids absent from the map get no entry — the caller's existing
 * enrichment already handles them (or correctly leaves them blank).
 */
export async function resolveShareClassProjections(
  bwSymIds: string[],
  asOf?: string,
): Promise<Map<string, ShareClassProjection>> {
  const out = new Map<string, ShareClassProjection>();
  const ids = [...new Set(bwSymIds.filter(Boolean))];
  if (!ids.length) return out;
  const d = asOf ?? todayUtc();

  try {
    const supabase = createAdminClient();
    // Closed-interval window filter, matching the mirror's documented
    // semantics (valid_to inclusive — NOT security_aliases' half-open).
    const { data: requestedRows, error } = await supabase
      .from("security_company_map")
      .select(COLUMNS)
      .in("bw_sym_id", ids)
      .lte("valid_from", d)
      .or(`valid_to.is.null,valid_to.gte.${d}`);
    if (error) throw error;
    const requested = pickByLatestValidFrom(
      (requestedRows ?? []) as MapRow[],
      (r) => r.bw_sym_id,
    );

    const companiesNeedingModelled = [
      ...new Set(
        [...requested.values()]
          .filter((r) => !r.is_modelled_class)
          .map((r) => r.company_id),
      ),
    ];
    if (!companiesNeedingModelled.length) return out;

    const { data: modelledRows, error: modelledError } = await supabase
      .from("security_company_map")
      .select(COLUMNS)
      .in("company_id", companiesNeedingModelled)
      .eq("is_modelled_class", true)
      .lte("valid_from", d)
      .or(`valid_to.is.null,valid_to.gte.${d}`);
    if (modelledError) throw modelledError;
    const modelledByCompany = pickByLatestValidFrom(
      (modelledRows ?? []) as MapRow[],
      (r) => r.company_id,
    );

    for (const [id, row] of requested) {
      if (row.is_modelled_class) continue;
      const modelled = modelledByCompany.get(row.company_id);
      // A company with no modelled class valid at asOf projects to nothing —
      // the class genuinely wasn't modelled then, and blank is the truth.
      if (!modelled || modelled.bw_sym_id === id) continue;
      out.set(id, {
        modelled_security_id: modelled.bw_sym_id,
        requested_ticker: row.ticker ?? null,
        requested_name: row.company_name ?? null,
        requested_class: row.share_class ?? null,
        modelled_ticker: modelled.ticker ?? null,
        modelled_class: modelled.share_class ?? null,
      });
    }
    return out;
  } catch (error) {
    console.error("[Company Map DAL] projection resolve failed", error);
    return out;
  }
}
