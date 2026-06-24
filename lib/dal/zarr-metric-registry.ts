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
      level:
        | "market"
        | "sector"
        | "subsector"
        | "lstar"
        | "stock_specific_l3"
        | "stock_specific_lstar";
    }
  | {
      /**
       * Flat (teo, symbol) var in the returns zarr — no level dim. Used for
       * companion arrays alongside the level-indexed cubes (e.g. lstar_level).
       * Reader returns the raw numeric value unless `nullSentinel` is set, in
       * which case matching values are mapped to null at the API boundary.
       */
      role: "returnsFlat";
      zarrVar: string;
      /** Treat this raw value as "missing" — emit null instead. */
      nullSentinel?: number;
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

  // Lstar-dispatched idiosyncratic return: residual_return.sel(level='lstar')
  // is materialized in the returns zarr at the canonical 1% threshold by
  // erm3.shared.output_manager.materialize_lstar_level_in_returns_zarr. SDK
  // callers wanting a non-default threshold still hit GET /lstar.
  lstar_rr: { role: "returns", zarrVar: "residual_return", level: "lstar" },

  // v4 stock-specific (doubly-cleaned) residual returns. The producer
  // (erm3 output_manager.materialize, e4cab09) writes two new levels in
  // ds_erm3_returns: stock_specific_l3 (OLS ff3 strip off the fixed L3 subsector
  // residual) and stock_specific_lstar (off the adaptive lstar residual = the
  // skill feature). factor_return / combined_factor_return are NaN at these
  // levels — only residual_return is meaningful, mirroring lstar_rr above.
  stock_specific_rr_l3: {
    role: "returns",
    zarrVar: "residual_return",
    level: "stock_specific_l3",
  },
  stock_specific_rr_lstar: {
    role: "returns",
    zarrVar: "residual_return",
    level: "stock_specific_lstar",
  },

  // Companion uint8 var: per (teo, symbol) which level Lstar dispatched to.
  // Raw encoding 0 = no recommendation (both L2 and L3 ER NaN), 1 = L1, 2 = L2,
  // 3 = L3. We map 0 → null at the API boundary so callers see null (matches
  // the `lstar: null` semantics of GET /lstar) or 1/2/3.
  lstar_level: { role: "returnsFlat", zarrVar: "lstar_level", nullSentinel: 0 },

  // v4 Tier-1 explained-variance scalars (ds_erm3_hedge_weights, L* skill basis —
  // see BWMACRO ff_block_architecture_decision.md). style_er = incremental size+value
  // share; stock_specific_er = final idiosyncratic share. style_er + stock_specific_er
  // ≈ the L* residual share; style is diagnostic (no hedge notional).
  style_er: { role: "hedge", zarrVar: "Style_ER_lstar" },
  stock_specific_er: { role: "hedge", zarrVar: "StockSpecific_ER_lstar" },
  // L3 (tradeable-hedge basis) variants — used by /api/v4/decompose basis="L3"
  // (default) so the market+industry+style+stock_specific variance partition sums
  // cleanly to ~1 (l3_res_er ≈ Style_ER_l3 + StockSpecific_ER_l3).
  style_er_l3: { role: "hedge", zarrVar: "Style_ER_l3" },
  stock_specific_er_l3: { role: "hedge", zarrVar: "StockSpecific_ER_l3" },

  // Fama–French style cascade — HEDGE vars only (ds_erm3_hedge_weights). The v4
  // producer (e4cab09) retired the FF *returns* levels (l2_ff_smb / l3_ff_smb_hml)
  // from ds_erm3_returns, so the style-axis residual-return series is gone; style
  // is now a diagnostic ER/HR block. See docs/ERM3_STOCK_SPECIFIC_DEEP_PANEL_UPDATE.md §1.
  l2_ff_smb_er: { role: "hedge", zarrVar: "L2_ff_smb_ER" },
  l3_ff_smb_er: { role: "hedge", zarrVar: "L3_ff_smb_ER" },
  l3_ff_hml_er: { role: "hedge", zarrVar: "L3_ff_hml_ER" },
  l2_ff_mkt_hr: { role: "hedge", zarrVar: "L2_ff_market_HR" },
  l2_ff_smb_hr: { role: "hedge", zarrVar: "L2_ff_smb_HR" },
  l3_ff_mkt_hr: { role: "hedge", zarrVar: "L3_ff_market_HR" },
  l3_ff_smb_hr: { role: "hedge", zarrVar: "L3_ff_smb_HR" },
  l3_ff_hml_hr: { role: "hedge", zarrVar: "L3_ff_hml_HR" },
};

export function getZarrSpec(key: V3MetricKey): ZarrMetricSpec | undefined {
  return REGISTRY[key];
}
