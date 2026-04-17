/**
 * Canonical macro + style factor keys for `macro_factors.factor_key` (lowercase).
 *
 * The macro sleeve (10 keys) mirrors `ds_macro_factor.zarr`'s `factor` coord
 * (see `erm3/shared/macro_factor_constants.py::FACTOR_KEYS_ORDER`). The style
 * sleeve (8 keys) is mirrored from `ds_etf.zarr` into the same Supabase
 * `macro_factors` table by `sync_style_factors_to_public` — rows carry
 * `metadata.category = "style"` so callers can distinguish the two sleeves.
 *
 * Two volatility factors are intentional on the macro side:
 *
 *   - `volatility` — VXX short-term futures ETF. Captures roll cost and
 *     term-structure dynamics; what a trader who SHORTS vol cares about.
 *   - `vix_spot`   — FRED VIXCLS, the spot index. Pure "fear gauge," no
 *     futures plumbing; what risk-off regime detection cares about.
 *
 * Style factors are raw ETF daily total returns. Because the ERM3 residual
 * (`return_type=l3_residual`) is orthogonal to SPY, the sector ETF, and the
 * subsector ETF by construction, correlating the residual with raw style-ETF
 * returns yields a clean read on pure-style exposure: the market/sector
 * components embedded in the style ETFs contribute zero.
 *
 * Keep in sync with OPENAPI_SPEC.yaml, SEMANTIC_ALIASES.md, mcp/data/openapi.json,
 * and the Python SDK / `erm3/shared/macro_factor_constants.py`.
 */

// Macro sleeve (backed by ds_macro_factor.zarr).
export const MACRO_SLEEVE_FACTORS = [
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

// Style sleeve (mirrored from ds_etf.zarr into macro_factors).
// History: USMV/SCHD back to 2011-10, MOAT 2012-04, MTUM/QUAL/VLUE 2013,
// IWF/IWM back to 2000-05. Short-history MSCI factors simply yield null
// correlations on pre-launch windows.
export const STYLE_SLEEVE_FACTORS = [
  "momentum",   // MTUM
  "quality",    // QUAL
  "low_vol",    // USMV
  "value",      // VLUE
  "growth",     // IWF
  "size",       // IWM
  "dividend",   // SCHD
  "moat",       // MOAT
] as const;

// All canonical factor_keys the correlation endpoints accept.
export const DEFAULT_MACRO_FACTORS = [
  ...MACRO_SLEEVE_FACTORS,
  ...STYLE_SLEEVE_FACTORS,
] as const;

export type MacroFactorKey = (typeof DEFAULT_MACRO_FACTORS)[number];
export type MacroSleeveKey = (typeof MACRO_SLEEVE_FACTORS)[number];
export type StyleSleeveKey = (typeof STYLE_SLEEVE_FACTORS)[number];

const CANONICAL = new Set<string>(DEFAULT_MACRO_FACTORS);

const STYLE_SET = new Set<string>(STYLE_SLEEVE_FACTORS);

export function isStyleFactorKey(key: string): key is StyleSleeveKey {
  return STYLE_SET.has(key);
}

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
  // Style sleeve (mirrored from ds_etf.zarr; each canonical key maps 1:1 to
  // its underlying style ETF ticker so either label resolves in aliases).
  momentum: ["momentum"],
  quality: ["quality"],
  low_vol: ["low_vol"],
  value: ["value"],
  growth: ["growth"],
  size: ["size"],
  dividend: ["dividend"],
  moat: ["moat"],
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
  // momentum → MTUM
  momentum: "momentum",
  mom: "momentum",
  mtum: "momentum",
  // quality → QUAL
  quality: "quality",
  qual: "quality",
  // low_vol → USMV
  low_vol: "low_vol",
  lowvol: "low_vol",
  min_vol: "low_vol",
  minvol: "low_vol",
  usmv: "low_vol",
  splv: "low_vol",
  // value → VLUE
  value: "value",
  val: "value",
  vlue: "value",
  // growth → IWF
  growth: "growth",
  grw: "growth",
  iwf: "growth",
  // size → IWM (small-cap)
  size: "size",
  small_cap: "size",
  smallcap: "size",
  iwm: "size",
  // dividend → SCHD
  dividend: "dividend",
  div: "dividend",
  yield: "dividend",
  schd: "dividend",
  hdv: "dividend",
  // moat → MOAT
  moat: "moat",
  wide_moat: "moat",
  widemoat: "moat",
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
