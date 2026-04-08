/**
 * Canonical macro factor keys for `macro_factors.factor_key` (lowercase).
 * Keep in sync with OPENAPI_SPEC.yaml and the Python SDK.
 */

export const DEFAULT_MACRO_FACTORS = [
  "bitcoin",
  "gold",
  "oil",
  "dxy",
  "vix",
  "ust10y2y",
] as const;

export type MacroFactorKey = (typeof DEFAULT_MACRO_FACTORS)[number];

const CANONICAL = new Set<string>(DEFAULT_MACRO_FACTORS);

/**
 * Supabase `macro_factors.factor_key` values to load for each API-facing key.
 * Order is merge preference (first = wins over later when the same `teo` exists in multiple series).
 * Includes legacy ERM3 names still present in older backfills (`vix_spot`, `usd`, `term_spread`).
 */
export const MACRO_FACTOR_DB_KEYS: Record<MacroFactorKey, readonly string[]> = {
  bitcoin: ["bitcoin"],
  gold: ["gold"],
  oil: ["oil"],
  dxy: ["dxy", "usd"],
  vix: ["vix", "vix_spot"],
  ust10y2y: ["ust10y2y", "term_spread"],
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

/** Common aliases → canonical DB / API keys (all matching is case-insensitive). */
const MACRO_FACTOR_ALIASES: Record<string, MacroFactorKey> = {
  btc: "bitcoin",
  xbt: "bitcoin",
  bitcoin: "bitcoin",
  gold: "gold",
  xau: "gold",
  oil: "oil",
  wti: "oil",
  brent: "oil",
  dxy: "dxy",
  usd: "dxy",
  dollar: "dxy",
  vix: "vix",
  ust10y2y: "ust10y2y",
  "10y2y": "ust10y2y",
  "10y-2y": "ust10y2y",
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
