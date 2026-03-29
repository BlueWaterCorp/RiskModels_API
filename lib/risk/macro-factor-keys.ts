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
