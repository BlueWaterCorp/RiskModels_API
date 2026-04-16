/**
 * Maps V3 `metric_key` values (Supabase / API) to ERM3 zarr variables.
 * Aligned with `sdk/riskmodels/snapshots/zarr_context.py` and SEMANTIC_ALIASES.md.
 */

import type { V3MetricKey } from "./risk-engine-v3";

export type ZarrDatasetRole = "daily" | "returns" | "hedge";

export type ZarrMetricSpec =
  | {
      role: "daily";
      zarrVar: string;
    }
  | {
      role: "returns";
      zarrVar: "combined_factor_return" | "factor_return" | "residual_return";
      level: "market" | "sector" | "subsector";
    }
  | {
      role: "hedge";
      zarrVar: string;
    }
  | {
      role: "hedge";
      zarrVar: "_stock_var";
      /** Emit vol_23d = sqrt(stock_var * 252) instead of raw _stock_var */
      derivedVol23d: true;
    }
  | {
      role: "hedge";
      zarrVar: "_stock_var";
      /** Emit stock_var as metric_value */
      asStockVar: true;
    };

/** Metrics that must stay on Supabase (not in the locked zarr trio). */
export const ZARR_UNSUPPORTED_DAILY_KEYS = new Set<V3MetricKey>([
  "l1_mkt_beta",
  "l2_sec_beta",
  "l3_sub_beta",
]);

export function isRankingMetricKey(key: string): boolean {
  return key.startsWith("rank_ord_") || key.startsWith("cohort_size_");
}

const REGISTRY: Partial<Record<V3MetricKey, ZarrMetricSpec>> = {
  returns_gross: { role: "daily", zarrVar: "return" },
  price_close: { role: "daily", zarrVar: "close" },
  market_cap: { role: "daily", zarrVar: "market_cap" },
  vol_23d: { role: "hedge", zarrVar: "_stock_var", derivedVol23d: true },
  stock_var: { role: "hedge", zarrVar: "_stock_var", asStockVar: true },

  l1_mkt_hr: { role: "hedge", zarrVar: "L1_market_HR" },
  l1_mkt_er: { role: "hedge", zarrVar: "L1_market_ER" },
  l1_res_er: { role: "hedge", zarrVar: "L1_residual_ER" },
  l1_cfr: { role: "returns", zarrVar: "combined_factor_return", level: "market" },
  l1_fr: { role: "returns", zarrVar: "factor_return", level: "market" },
  l1_rr: { role: "returns", zarrVar: "residual_return", level: "market" },

  l2_mkt_hr: { role: "hedge", zarrVar: "L2_market_HR" },
  l2_sec_hr: { role: "hedge", zarrVar: "L2_sector_HR" },
  l2_mkt_er: { role: "hedge", zarrVar: "L2_market_ER" },
  l2_sec_er: { role: "hedge", zarrVar: "L2_sector_ER" },
  l2_res_er: { role: "hedge", zarrVar: "L2_residual_ER" },
  l2_cfr: { role: "returns", zarrVar: "combined_factor_return", level: "sector" },
  l2_fr: { role: "returns", zarrVar: "factor_return", level: "sector" },
  l2_rr: { role: "returns", zarrVar: "residual_return", level: "sector" },

  l3_mkt_hr: { role: "hedge", zarrVar: "L3_market_HR" },
  l3_sec_hr: { role: "hedge", zarrVar: "L3_sector_HR" },
  l3_sub_hr: { role: "hedge", zarrVar: "L3_subsector_HR" },
  l3_mkt_er: { role: "hedge", zarrVar: "L3_market_ER" },
  l3_sec_er: { role: "hedge", zarrVar: "L3_sector_ER" },
  l3_sub_er: { role: "hedge", zarrVar: "L3_subsector_ER" },
  l3_res_er: { role: "hedge", zarrVar: "L3_residual_ER" },
  l3_cfr: { role: "returns", zarrVar: "combined_factor_return", level: "subsector" },
  l3_fr: { role: "returns", zarrVar: "factor_return", level: "subsector" },
  l3_rr: { role: "returns", zarrVar: "residual_return", level: "subsector" },
};

export function getZarrSpec(key: V3MetricKey): ZarrMetricSpec | undefined {
  return REGISTRY[key];
}
