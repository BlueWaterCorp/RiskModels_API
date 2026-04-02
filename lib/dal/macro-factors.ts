/**
 * Read daily macro factor returns from Supabase `macro_factors` (long format).
 * Used by GET /api/macro-factors and kept separate from correlation caching.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_MACRO_FACTORS,
  normalizeMacroFactorKeys,
} from "@/lib/risk/macro-factor-keys";

export interface MacroFactorSeriesRow {
  factor_key: string;
  teo: string;
  return_gross: number | null;
  metadata?: Record<string, unknown>;
}

function normalizeTeo(raw: string): string {
  const s = String(raw);
  return s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
}

/**
 * Fetch macro factor rows for canonical keys in [startTeo, endTeo] inclusive (DATE).
 */
export async function fetchMacroFactorSeriesRows(
  factorKeysInput: string[],
  startTeo: string,
  endTeo: string,
): Promise<{
  rows: MacroFactorSeriesRow[];
  warnings: string[];
  factors_requested: string[];
}> {
  const source =
    factorKeysInput.length > 0 ? factorKeysInput : [...DEFAULT_MACRO_FACTORS];
  const { keys: keysCanon, warnings } = normalizeMacroFactorKeys(source);
  if (keysCanon.length === 0) {
    return {
      rows: [],
      warnings: [...warnings, "No valid macro factor keys"],
      factors_requested: [],
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("macro_factors")
    .select("factor_key, teo, return_gross, metadata")
    .in("factor_key", keysCanon)
    .gte("teo", startTeo)
    .lte("teo", endTeo)
    .order("teo", { ascending: true });

  if (error) {
    console.error("[macro_factors] series query error:", error);
    return {
      rows: [],
      warnings: [...warnings, "Database query failed"],
      factors_requested: [...keysCanon],
    };
  }

  const rows: MacroFactorSeriesRow[] = (data ?? []).map((row) => {
    const meta = row.metadata;
    const hasMeta =
      meta &&
      typeof meta === "object" &&
      !Array.isArray(meta) &&
      Object.keys(meta as object).length > 0;
    return {
      factor_key: row.factor_key as string,
      teo: normalizeTeo(String(row.teo)),
      return_gross: row.return_gross as number | null,
      metadata: hasMeta ? (meta as Record<string, unknown>) : undefined,
    };
  });

  return { rows, warnings, factors_requested: [...keysCanon] };
}
