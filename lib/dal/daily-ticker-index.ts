/**
 * Pure builder for the ds_daily ticker-holder index (no I/O, unit-tested).
 * `lib/dal/zarr-reader.ts` reads the four coords and calls `indexFromCoords`.
 *
 * Upper-cased ticker → bw_sym_ids. `byTicker` matches the display `ticker`,
 * the collision-free `unique_ticker`, or the listing `eodhd_code` minus a
 * trailing ".US"; `byDisplayTicker` matches the display `ticker` alone;
 * `byListingTicker` the stripped `eodhd_code` alone. lib/dal/ticker-holder
 * never derives liveness from these labels (security_master decides); it uses
 * them for recall and dates. ds_daily keeps every identity the pipeline ever
 * priced, delisted ones included, so this is where a ticker whose holder left
 * the live `symbols` mirror (CTRA → Coterra, BW-BBG000C3GN47) is still found.
 * `symbols` is every bw_sym_id on the store's symbol axis (data presence).
 */

export interface DailyTickerHolderIndex {
  byTicker: Map<string, string[]>;
  byDisplayTicker: Map<string, string[]>;
  /** `eodhd_code` minus ".US" — the listing the id was last priced under. */
  byListingTicker: Map<string, string[]>;
  symbols: Set<string>;
}

/**
 * Label of one coord cell. Only real strings count: NaN / null / undefined
 * fills from object-dtype coords become "" (so a real ticker spelled "NAN"
 * or "NULL" is kept, unlike a String(x) round-trip).
 */
function cellLabel(x: unknown): string {
  return typeof x === "string" ? x.trim().toUpperCase() : "";
}

/**
 * Builds the index, or null (fail closed) when the symbol axis is missing,
 * holds duplicates or blanks, or any of the three label coords is missing or
 * misaligned with it — a partial index would change which holder wins.
 */
export function indexFromCoords(
  symbols: readonly unknown[] | null,
  display: readonly unknown[] | null,
  unique: readonly unknown[] | null,
  eodhd: readonly unknown[] | null,
): DailyTickerHolderIndex | null {
  if (!symbols?.length) return null;
  const syms = symbols.map((s) => (typeof s === "string" ? s.trim() : ""));
  const symSet = new Set(syms);
  if (symSet.size !== syms.length || symSet.has("")) return null;
  for (const coord of [display, unique, eodhd]) {
    if (!coord || coord.length !== syms.length) return null;
  }

  const byTicker = new Map<string, string[]>();
  const byDisplayTicker = new Map<string, string[]>();
  const byListingTicker = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, t: string, sym: string) => {
    if (!t) return;
    const list = m.get(t) ?? [];
    if (!list.includes(sym)) list.push(sym);
    m.set(t, list);
  };
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i]!;
    const d = cellLabel(display![i]);
    const u = cellLabel(unique![i]);
    // eodhd_code carries the listing exchange ("CTRA.US"); the ticker is the
    // code minus that US suffix. Other codes pass through unchanged.
    const l = cellLabel(eodhd![i]).replace(/\.US$/, "");
    add(byTicker, d, sym);
    add(byDisplayTicker, d, sym);
    add(byTicker, u, sym);
    add(byTicker, l, sym);
    add(byListingTicker, l, sym);
  }
  return { byTicker, byDisplayTicker, byListingTicker, symbols: symSet };
}
