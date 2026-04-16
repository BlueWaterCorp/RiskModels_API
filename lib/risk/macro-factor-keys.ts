/**
 * Canonical macro factor keys for `macro_factors.factor_key` (lowercase).
 *
 * The ten canonical keys mirror `ds_macro_factor.zarr`'s `factor` coord
 * (see `erm3/shared/macro_factor_constants.py::FACTOR_KEYS_ORDER`) and the
 * Supabase `macro_factors` rows. Two volatility factors are intentional:
 *
 *   - `volatility` — VXX short-term futures ETF. Captures roll cost and
 *     term-structure dynamics; what a trader who SHORTS vol cares about.
 *   - `vix_spot`   — FRED VIXCLS, the spot index. Pure "fear gauge," no
 *     futures plumbing; what risk-off regime detection cares about.
 *
 * Keep in sync with OPENAPI_SPEC.yaml and the Python SDK.
 */

export const DEFAULT_MACRO_FACTORS = [
  "inflation",
  "term_spread",
  "short_rates",
  "credit",
  "oil",
  "gold",
  "usd",
  "volatility",
  "bitcoin",
  "vix_spot",
] as const;

export type MacroFactorKey = (typeof DEFAULT_MACRO_FACTORS)[number];

const CANONICAL = new Set<string>(DEFAULT_MACRO_FACTORS);

/**
 * Supabase `macro_factors.factor_key` values to load for each API-facing key.
 * Order is merge preference (first = wins over later when the same `teo` exists
 * in multiple series). Legacy v1 names from older backfills are listed as
 * fall-through aliases so historical rows still resolve.
 */
export const MACRO_FACTOR_DB_KEYS: Record<MacroFactorKey, readonly string[]> = {
  inflation: ["inflation"],
  term_spread: ["term_spread", "ust10y2y"],   // ust10y2y = legacy v1 name
  short_rates: ["short_rates"],
  credit: ["credit"],
  oil: ["oil"],
  gold: ["gold"],
  usd: ["usd", "dxy"],                        // dxy = legacy v1 name
  volatility: ["volatility"],
  bitcoin: ["bitcoin"],
  vix_spot: ["vix_spot", "vix"],              // vix = legacy v1 name
} as const;

/** Flat list for `.in("factor_key", …)` queries (deduped). */
export function expandMacroFactorDbKeysForQuery(keys: MacroFactorKey[]): string[] {
  const s = new Set<string>();
  for (const k of keys) {
    for (const db of MACRO_FACTOR_DB_KEYS[k] ?? [k]) {
      s.add(db);
    }
  }
  return [...s];
}

/**
 * Common aliases → canonical DB / API keys. All matching is case-insensitive.
 * Every legacy v1 name and every common external name (WTI, DXY, 10y2y, etc.)
 * maps to its modern canonical key so API callers can use either.
 */
const MACRO_FACTOR_ALIASES: Record<string, MacroFactorKey> = {
  // inflation
  inflation: "inflation",
  cpi: "inflation",
  tips: "inflation",
  tip: "inflation",
  // term_spread
  term_spread: "term_spread",
  ust10y2y: "term_spread",
  "10y2y": "term_spread",
  "10y-2y": "term_spread",
  ust: "term_spread",
  vgit: "term_spread",
  // short_rates
  short_rates: "short_rates",
  short_rate: "short_rates",
  rates: "short_rates",
  bil: "short_rates",
  tbill: "short_rates",
  // credit
  credit: "credit",
  credit_spread: "credit",
  hy: "credit",
  hyg: "credit",
  // oil
  oil: "oil",
  wti: "oil",
  brent: "oil",
  uso: "oil",
  // gold
  gold: "gold",
  xau: "gold",
  gld: "gold",
  bullion: "gold",
  // usd
  usd: "usd",
  dxy: "usd",
  dollar: "usd",
  uup: "usd",
  // volatility (futures-based)
  volatility: "volatility",
  vxx: "volatility",
  vol: "volatility",
  // bitcoin
  bitcoin: "bitcoin",
  btc: "bitcoin",
  xbt: "bitcoin",
  bito: "bitcoin",
  // vix_spot (FRED VIXCLS)
  vix_spot: "vix_spot",
  vix: "vix_spot",
  vixcls: "vix_spot",
};

export function resolveMacroFactorKey(raw: string): MacroFactorKey | null {
  const s = raw.trim().toLowerCase();
  if (CANONICAL.has(s)) return s as MacroFactorKey;
  const mapped = MACRO_FACTOR_ALIASES[s];
  return mapped ?? null;
}

/**
 * Normalize client-supplied factor names to canonical keys for Supabase queries
 * and correlation output keys.
 */
export function normalizeMacroFactorKeys(factors: string[]): {
  keys: MacroFactorKey[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const keys: MacroFactorKey[] = [];
  const seen = new Set<MacroFactorKey>();

  for (const raw of factors) {
    const k = resolveMacroFactorKey(raw);
    if (!k) {
      warnings.push(
        `Unknown macro factor "${raw}"; use one of: ${DEFAULT_MACRO_FACTORS.join(", ")}`,
      );
      continue;
    }
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }

  return { keys, warnings };
}
