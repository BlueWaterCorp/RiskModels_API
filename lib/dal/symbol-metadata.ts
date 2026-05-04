/**
 * Safelist filter for the `symbols.metadata` JSONB column.
 *
 * The `metadata` JSONB stored in Supabase contains fields populated upstream
 * by `ERM3/scripts/python/sync_erm3_to_supabase.py` from the security_master
 * table — including licensed third-party identifiers (`isin`, `cusip`) and // licensed-id-ok: descriptive docstring naming the fields this helper strips; no values exposed
 * licensed industry codes (`industry_code` = FactSet `fs_industry_code`).
 *
 * Public API surfaces must NOT redistribute those fields. This helper
 * restricts whole-metadata passthrough to a small allowlist of fields that
 * are either internally derived (FIGI, BW ETF mappings) or non-sensitive
 * (sector name, company name, delisted flag).
 *
 * Why a helper rather than per-route filtering: keeps the safelist in one
 * place so adding a new route doesn't risk reintroducing the leak.
 */

const SAFE_METADATA_KEYS = [
  "figi",          // Open identifier (Bloomberg OpenFIGI)
  "sector",        // GICS sector NAME (e.g. "Technology") — non-sensitive label
  "company_name",  // Public company name
  "market_etf",    // BW-derived ETF mapping
  "sector_etf",    // BW-derived ETF mapping
  "subsector_etfs",// BW-derived ETF mapping array
  "is_delisted",   // Boolean flag
  "unique_ticker", // BW-derived disambiguated ticker
] as const;

const SAFE_KEYS_SET = new Set<string>(SAFE_METADATA_KEYS);

export type SafeSymbolMetadata = Partial<{
  figi: string | null;
  sector: string | null;
  company_name: string | null;
  market_etf: string | null;
  sector_etf: string | null;
  subsector_etfs: string[] | null;
  is_delisted: boolean | null;
  unique_ticker: string | null;
}>;

export function filterSafeMetadata(
  metadata: unknown,
): SafeSymbolMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (SAFE_KEYS_SET.has(key)) {
      out[key] = value;
    }
  }
  return out as SafeSymbolMetadata;
}
