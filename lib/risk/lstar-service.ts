/**
 * Lstar (L*) Selection Service
 *
 * Per-(ticker, teo) hedge-level recommendation. The simplest level whose
 * marginal explained-return (ER) clears a threshold:
 *
 *   if L3_subsector_ER >= θ → L3 (3-ETF hedge: market + sector + subsector)
 *   elif L2_sector_ER  >= θ → L2 (2-ETF hedge: market + sector)
 *   else                   → L1 (1-ETF hedge: market only)
 *
 * Default θ = 1%. The chat-default route hardcodes this; SDK callers can pass
 * an override.
 *
 * Lstar is materialized in the ERM3 hedge-weights zarr as a convenience for
 * direct zarr consumers, but the API computes live from the L2/L3 ER inputs
 * already exposed by the V3 DAL. Live derivation lets callers tune θ without
 * waiting for an ERM3 rebuild.
 *
 * Background: see RM_ORG/content/Medium/series/drafts/lstar_selection/article.md
 * for the side study that locked the 1% / 1m default.
 */

import {
  resolveSymbolByTicker,
  fetchHistory,
  pivotHistory,
  extractMetric,
  type PivotedHistoryRow,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";

export const LSTAR_DEFAULT_THRESHOLD = 0.01;

export type LstarLevel = "L1" | "L2" | "L3";

export interface LstarResult {
  ticker: string;
  dates: string[];
  /** Recommended level per date, null where source ERs are unavailable. */
  lstar: (LstarLevel | null)[];
  /** Hedge ratio for the market ETF, drawn from the chosen level's solver. */
  market_hr: (number | null)[];
  /** Hedge ratio for the sector ETF; null when Lstar = L1. */
  sector_hr: (number | null)[];
  /** Hedge ratio for the subsector ETF; null when Lstar ∈ {L1, L2}. */
  subsector_hr: (number | null)[];
  /** Total explained-return at the chosen level (market + sector + subsector). */
  total_er: (number | null)[];
  /**
   * Daily simple residual return at the chosen Lstar level (`l1_rr` / `l2_rr` / `l3_rr`).
   * Parallel to `dates`; null when Lstar or source return is unavailable.
   */
  residual_return: (number | null)[];
  /** Raw inputs to the selection rule, surfaced for audit / SDK override. */
  l2_sector_er: (number | null)[];
  l3_subsector_er: (number | null)[];
  threshold_used: number;
  market_factor_etf: string;
  universe: string;
  data_source: string;
}

export function pickLstar(
  l2SecEr: number | null,
  l3SubEr: number | null,
  threshold: number,
): LstarLevel | null {
  // Both inputs null → can't decide (pre-IPO, delisted, masked).
  if (l2SecEr == null && l3SubEr == null) return null;
  // The selection rule is order-sensitive — check L3 first (highest granularity
  // that meets the bar), then L2, default L1. NaN-safe via null coalescing.
  if (l3SubEr != null && l3SubEr >= threshold) return "L3";
  if (l2SecEr != null && l2SecEr >= threshold) return "L2";
  return "L1";
}

/** Residual return at the chosen Lstar level (same dispatch rule as hedge ratios). */
export function dispatchLstarResidualReturn(
  chosen: LstarLevel | null,
  row: PivotedHistoryRow,
): number | null {
  if (chosen === "L3") return extractMetric(row, "l3_rr");
  if (chosen === "L2") return extractMetric(row, "l2_rr");
  if (chosen === "L1") return extractMetric(row, "l1_rr");
  return null;
}

export class LstarService {
  /**
   * Resolve Lstar + dispatched hedge ratios for a ticker across a daily window.
   *
   * @param ticker          Stock ticker (e.g. "AAPL")
   * @param marketFactorEtf Market factor ETF (default "SPY")
   * @param options.years   Calendar years of history (default 1)
   * @param options.threshold  Marginal-ER threshold; default 1%
   */
  async getLstar(
    ticker: string,
    marketFactorEtf: string = "SPY",
    options?: { years?: number; threshold?: number },
  ): Promise<LstarResult | null> {
    const upperTicker = ticker.toUpperCase();
    const years = options?.years ?? 1;
    const threshold = options?.threshold ?? LSTAR_DEFAULT_THRESHOLD;

    const symbolRecord = await resolveSymbolByTicker(upperTicker);
    if (!symbolRecord) return null;

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const startDateStr = startDate.toISOString().split("T")[0]!;

    const keys: V3MetricKey[] = [
      "l1_mkt_hr",
      "l2_mkt_hr",
      "l2_sec_hr",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l1_mkt_er",
      "l2_mkt_er",
      "l2_sec_er",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l1_rr",
      "l2_rr",
      "l3_rr",
    ];

    const rows = await fetchHistory(symbolRecord.symbol, keys, {
      periodicity: "daily",
      startDate: startDateStr,
      orderBy: "asc",
    });

    if (rows.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, threshold);
    }

    const pivoted = pivotHistory(rows);
    if (pivoted.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, threshold);
    }

    const dates = pivoted.map((p) => p.teo);
    const lstar: (LstarLevel | null)[] = [];
    const market_hr: (number | null)[] = [];
    const sector_hr: (number | null)[] = [];
    const subsector_hr: (number | null)[] = [];
    const total_er: (number | null)[] = [];
    const residual_return: (number | null)[] = [];
    const l2_sector_er: (number | null)[] = [];
    const l3_subsector_er: (number | null)[] = [];

    for (const p of pivoted) {
      const l2s = (p.l2_sec_er as number | null) ?? null;
      const l3ss = (p.l3_sub_er as number | null) ?? null;
      const chosen = pickLstar(l2s, l3ss, threshold);
      lstar.push(chosen);
      l2_sector_er.push(l2s);
      l3_subsector_er.push(l3ss);

      // Dispatch hedges and total ER to the chosen level. Each L* is a
      // self-contained hedge solution — we use its own market/sector/subsector
      // HRs as emitted by the ERM3 solver, not a stitched-across-levels sum.
      if (chosen === "L3") {
        market_hr.push((p.l3_mkt_hr as number | null) ?? null);
        sector_hr.push((p.l3_sec_hr as number | null) ?? null);
        subsector_hr.push((p.l3_sub_hr as number | null) ?? null);
        const m = (p.l3_mkt_er as number | null) ?? 0;
        const s = (p.l3_sec_er as number | null) ?? 0;
        const ss = l3ss ?? 0;
        total_er.push(m + s + ss);
      } else if (chosen === "L2") {
        market_hr.push((p.l2_mkt_hr as number | null) ?? null);
        sector_hr.push((p.l2_sec_hr as number | null) ?? null);
        subsector_hr.push(null);
        const m = (p.l2_mkt_er as number | null) ?? 0;
        const s = l2s ?? 0;
        total_er.push(m + s);
      } else if (chosen === "L1") {
        market_hr.push((p.l1_mkt_hr as number | null) ?? null);
        sector_hr.push(null);
        subsector_hr.push(null);
        const m = (p.l1_mkt_er as number | null) ?? null;
        total_er.push(m);
      } else {
        market_hr.push(null);
        sector_hr.push(null);
        subsector_hr.push(null);
        total_er.push(null);
      }

      residual_return.push(dispatchLstarResidualReturn(chosen, p));
    }

    return {
      ticker: upperTicker,
      dates,
      lstar,
      market_hr,
      sector_hr,
      subsector_hr,
      total_er,
      residual_return,
      l2_sector_er,
      l3_subsector_er,
      threshold_used: threshold,
      market_factor_etf: marketFactorEtf,
      universe: "US_EQUITY",
      data_source: "zarr",
    };
  }

  private emptyResult(
    ticker: string,
    marketFactorEtf: string,
    threshold: number,
  ): LstarResult {
    return {
      ticker,
      dates: [],
      lstar: [],
      market_hr: [],
      sector_hr: [],
      subsector_hr: [],
      total_er: [],
      residual_return: [],
      l2_sector_er: [],
      l3_subsector_er: [],
      threshold_used: threshold,
      market_factor_etf: marketFactorEtf,
      universe: "US_EQUITY",
      data_source: "zarr",
    };
  }
}

let _instance: LstarService | null = null;
export function getLstarService(): LstarService {
  if (!_instance) {
    _instance = new LstarService();
  }
  return _instance;
}
