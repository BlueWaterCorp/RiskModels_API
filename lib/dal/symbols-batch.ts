// licensed-id-ok-file: sibling of sym-id-scrub.ts (which carries the same marker). This module is the batch-resolver that feeds the scrub — it reads symbols.metadata.figi from Postgres to pick the FIGI substitute for ISIN-flavored bw_sym_ids. ISIN mentions in doc comments describe what we're scrubbing; no licensed identifier values leak to public responses. See MASTER_BACKLOG H.24.
/**
 * Batch-resolve `bw_sym_id` → `{ticker, figi}` for the public-API scrub
 * helpers in `sym-id-scrub.ts`, plus the convenience helper
 * `applyScrubToHoldings` for the holdings-list use case.
 *
 * Single round-trip to `public.symbols`. The select list reads
 * `symbol, ticker, metadata`; `metadata.figi` is the open Bloomberg
 * identifier (`symbol-metadata.ts` already lists `figi` as a safelisted
 * passthrough field).
 *
 * Caller hands in a list of `bw_sym_id` values (typically from a holdings
 * read); we return a map keyed by `bw_sym_id`. Missing rows are simply
 * absent from the map — the scrub helper's last-resort `BW-RESTRICTED`
 * fallback handles those.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { isIsinFlavoredSymId, scrubBwSymId } from "@/lib/dal/sym-id-scrub";

export interface BwSymIdResolution {
  bw_sym_id: string;
  ticker: string | null;
  figi: string | null;
}

/**
 * Resolve a batch of `bw_sym_id` values. Dedupes input; empty list short-
 * circuits to an empty map. Never throws — logs and returns whatever
 * resolved successfully so a partial Supabase failure doesn't take down
 * the holdings response.
 */
export async function resolveBwSymIdsForScrub(
  bwSymIds: readonly string[],
): Promise<Map<string, BwSymIdResolution>> {
  const out = new Map<string, BwSymIdResolution>();
  if (bwSymIds.length === 0) return out;

  const unique = Array.from(new Set(bwSymIds.filter((s) => !!s)));
  if (unique.length === 0) return out;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("symbols")
      .select("symbol, ticker, metadata")
      .in("symbol", unique);

    if (error) {
      console.error("[symbols-batch] resolve error:", error);
      return out;
    }

    for (const row of data ?? []) {
      const sym = (row as { symbol?: string }).symbol;
      if (!sym) continue;
      const md = ((row as { metadata?: Record<string, unknown> }).metadata ??
        {}) as Record<string, unknown>;
      const figi =
        typeof md.figi === "string" && md.figi.trim() ? md.figi.trim() : null;
      const ticker = ((row as { ticker?: string | null }).ticker ?? null);
      out.set(sym, { bw_sym_id: sym, ticker, figi });
    }
  } catch (err) {
    console.error("[symbols-batch] unexpected error:", err);
  }
  return out;
}

/**
 * Apply ISIN-leak scrub to a list of holdings rows with a `bw_sym_id`
 * field (fund / ETF / cohort holdings). Only fires the batch resolve
 * when at least one row is ISIN-flavored — FIGI-only inputs short-
 * circuit with zero DB round-trips.
 *
 * Returns a new array with potentially-rewritten `bw_sym_id` per row;
 * other fields are preserved via shallow spread. Caller-provided types
 * are preserved (generic `T extends { bw_sym_id: string }`).
 */
export async function applyScrubToHoldings<T extends { bw_sym_id: string }>(
  holdings: readonly T[],
): Promise<T[]> {
  if (holdings.length === 0) return [];

  const isinIds: string[] = [];
  for (const h of holdings) {
    if (isIsinFlavoredSymId(h.bw_sym_id)) isinIds.push(h.bw_sym_id);
  }
  if (isinIds.length === 0) return [...holdings];

  const resolved = await resolveBwSymIdsForScrub(isinIds);
  return holdings.map((h) => {
    if (!isIsinFlavoredSymId(h.bw_sym_id)) return { ...h };
    const r = resolved.get(h.bw_sym_id);
    return { ...h, bw_sym_id: scrubBwSymId(h.bw_sym_id, r) };
  });
}

/**
 * Same as `applyScrubToHoldings` but for the filer-holdings shape whose
 * identifier field is `security_id` (not `bw_sym_id`). Filer holdings
 * are post-D.8.1 bw_sym_id-keyed but the field name is preserved for
 * historical compat (pre-D.8.1 it was a raw security identifier).
 */
export async function applyScrubToFilerHoldings<
  T extends { security_id: string },
>(holdings: readonly T[]): Promise<T[]> {
  if (holdings.length === 0) return [];

  const isinIds: string[] = [];
  for (const h of holdings) {
    if (isIsinFlavoredSymId(h.security_id)) isinIds.push(h.security_id);
  }
  if (isinIds.length === 0) return [...holdings];

  const resolved = await resolveBwSymIdsForScrub(isinIds);
  return holdings.map((h) => {
    if (!isIsinFlavoredSymId(h.security_id)) return { ...h };
    const r = resolved.get(h.security_id);
    return { ...h, security_id: scrubBwSymId(h.security_id, r) };
  });
}

/**
 * Batch-resolve security ids to display labels from `public.symbols`
 * (`symbol` column is the same bw_sym_id namespace the filer/fund zarrs
 * carry post-D.8.1). Tickers and company names are public identifiers —
 * no licensing concern (unlike the ISIN scrub above).
 *
 * Never throws: a Supabase failure returns whatever resolved (possibly
 * empty) so label enrichment can't take down a holdings response.
 */
export interface SymbolDisplayLabel {
  ticker: string | null;
  name: string | null;
}

export async function resolveDisplayLabels(
  securityIds: readonly string[],
): Promise<Map<string, SymbolDisplayLabel>> {
  const out = new Map<string, SymbolDisplayLabel>();
  const unique = Array.from(new Set(securityIds.filter((s) => !!s)));
  if (unique.length === 0) return out;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("symbols")
      .select("symbol, ticker, name")
      .in("symbol", unique);

    if (error) {
      console.error("[symbols-batch] display-label resolve error:", error);
      return out;
    }

    for (const row of data ?? []) {
      const r = row as { symbol?: string; ticker?: string | null; name?: string | null };
      if (!r.symbol) continue;
      out.set(r.symbol, {
        ticker: r.ticker?.trim() || null,
        name: r.name?.trim() || null,
      });
    }
  } catch (e) {
    console.error("[symbols-batch] display-label resolve exception:", e);
  }
  return out;
}

/**
 * Reverse lookup `bw_sym_id` → ticker for ids a caller got back from a
 * holdings endpoint (`/funds/{id}/holdings`, filer and ETF holdings).
 *
 * Accepts every form the public scrub emits:
 *   • native ids (`BW-BBG000B9XRY4`) — matched on `symbols.symbol`;
 *   • `BW-TICKER-{TICKER}` — the ticker is the id itself, no lookup;
 *   • `BW-{FIGI}` substituted for an ISIN-flavored id — matched on
 *     `symbols.metadata->>figi` when the native match misses.
 * Results are keyed by the id as the caller sent it. Unresolved ids are
 * absent. Never throws.
 */
export async function resolveSymIdsToTickers(
  ids: readonly string[],
): Promise<Map<string, SymbolDisplayLabel>> {
  const out = new Map<string, SymbolDisplayLabel>();
  const unique = Array.from(new Set(ids.filter((s) => !!s)));
  const lookup: string[] = [];
  for (const id of unique) {
    if (id.startsWith("BW-TICKER-")) {
      const t = id.slice("BW-TICKER-".length).trim();
      if (t) out.set(id, { ticker: t, name: null });
    } else {
      lookup.push(id);
    }
  }
  if (lookup.length === 0) return out;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("symbols")
      .select("symbol, ticker, name")
      .in("symbol", lookup);
    if (error) {
      console.error("[symbols-batch] reverse resolve error:", error);
      return out;
    }
    for (const row of data ?? []) {
      const r = row as { symbol?: string; ticker?: string | null; name?: string | null };
      if (!r.symbol || !r.ticker?.trim()) continue;
      out.set(r.symbol, { ticker: r.ticker.trim(), name: r.name?.trim() || null });
    }

    const figiIds = lookup.filter((id) => !out.has(id) && /^BW-BBG[A-Z0-9]{9}$/.test(id));
    if (figiIds.length > 0) {
      const byFigi = new Map(figiIds.map((id) => [id.slice(3), id]));
      const { data: figiRows, error: figiErr } = await admin
        .from("symbols")
        .select("ticker, name, metadata->>figi")
        .in("metadata->>figi", Array.from(byFigi.keys()));
      if (figiErr) {
        console.error("[symbols-batch] reverse resolve (figi) error:", figiErr);
        return out;
      }
      for (const row of figiRows ?? []) {
        const r = row as { figi?: string; ticker?: string | null; name?: string | null };
        const id = r.figi ? byFigi.get(r.figi) : undefined;
        if (!id || out.has(id) || !r.ticker?.trim()) continue;
        out.set(id, { ticker: r.ticker.trim(), name: r.name?.trim() || null });
      }
    }
  } catch (e) {
    console.error("[symbols-batch] reverse resolve exception:", e);
  }
  return out;
}
