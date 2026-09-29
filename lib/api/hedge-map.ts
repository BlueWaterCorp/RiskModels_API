/**
 * Hedge map for the decompose routes.
 *
 * Sign convention: an ERM3 layer hedge ratio (`l3_mkt_hr`, `l3_sec_hr`,
 * `l3_sub_hr`) is the dollar position in the layer's ETF per $1 long stock,
 * HR = -(I-N)ᵀβ. Negative = short the ETF, positive = long the ETF. The stored
 * L1 market HR tracks -β to SPY with correlation -0.97 across the universe
 * (2026-09-29), so a long NVDA position (β ≈ 1.9) carries a negative market HR.
 * At L3 the legs offset: sector/subsector ETFs carry market beta, so a short
 * subsector leg can leave SPY positive (long) — 1,077 of 2,825 names on 2026-09-28.
 *
 * `hedge[etf]` is therefore the layer `hr` itself, summed when two layers share
 * one ETF (e.g. the subsector falls back to the sector ETF).
 */
export type HedgeLayer = { hr: number | null; hedge_etf: string | null };

export function buildHedgeMap(layers: Record<string, HedgeLayer>): Record<string, number> {
  const hedge: Record<string, number> = {};
  for (const name of ["market", "sector", "subsector"]) {
    const layer = layers[name];
    if (layer && layer.hedge_etf && layer.hr !== null && Number.isFinite(layer.hr)) {
      hedge[layer.hedge_etf] = (hedge[layer.hedge_etf] ?? 0) + layer.hr;
    }
  }
  return hedge;
}
