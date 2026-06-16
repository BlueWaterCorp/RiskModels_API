/**
 * Lstar (L*) Selection Service
 *
 * Per-(ticker, teo) hedge-level recommendation. The simplest level whose
 * marginal explained-return (ER) clears a threshold:
 *
 *   if L3 marginal ER >= θ → L3
 *   elif L2 marginal ER >= θ → L2
 *   else                   → L1
 *
 * Industry axis: L2_sector_ER / L3_subsector_ER (market → sector → subsector).
 * Style axis:    L2_ff_smb_ER / L3_ff_hml_ER (market → SMB → HML).
 *
 * Selection source. For the **industry axis at the canonical threshold** (no
 * caller-supplied θ), the materialized `lstar_level` column is the source of
 * truth — it carries whatever selector ERM3 shipped (the cost-aware GBM once
 * enabled; the 1% rule before that), so the API never re-derives the canonical
 * pick in TS. Live derivation (pickLstar over marginal ERs) is used only when
 * the materialized column is absent, or for the **style axis** / an **explicit
 * custom θ**, where the materialized column does not apply. Default θ = 1%.
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

/** Which cascade the marginal ERs belong to (same L1/L2/L3 depth rule). */
export type LstarAxis = "industry" | "style";

/** Zarr / V3 metric names for the two marginal ER inputs, by axis. */
export const LSTAR_MARGINAL_ER_KEYS: Record<
  LstarAxis,
  { l2: string; l3: string; description: string }
> = {
  industry: {
    l2: "L2_sector_ER",
    l3: "L3_subsector_ER",
    description: "market → +sector → +subsector",
  },
  style: {
    l2: "L2_ff_smb_ER",
    l3: "L3_ff_hml_ER",
    description: "market → +SMB → +HML",
  },
};

export interface LstarResult {
  ticker: string;
  /** `industry` (default) or `style` — determines marginal ER / HR semantics. */
  axis: LstarAxis;
  dates: string[];
  /** Recommended level per date, null where source ERs are unavailable. */
  lstar: (LstarLevel | null)[];
  /** Hedge ratio for the market ETF, drawn from the chosen level's solver. */
  market_hr: (number | null)[];
  /**
   * Second-leg hedge ratio. Industry: sector ETF. Style: SMB spread.
   * Null when Lstar = L1.
   */
  sector_hr: (number | null)[];
  /**
   * Third-leg hedge ratio. Industry: subsector ETF. Style: HML spread.
   * Null when Lstar ∈ {L1, L2}.
   */
  subsector_hr: (number | null)[];
  /** Total explained-return at the chosen level. */
  total_er: (number | null)[];
  /**
   * Daily simple residual return at the chosen Lstar level.
   * Industry: `l1_rr` / `l2_rr` / `l3_rr`. Style: `l1_rr` / `l2_ff_smb_rr` / `l3_ff_smb_hml_rr`.
   */
  residual_return: (number | null)[];
  /**
   * Raw marginal ER inputs to the selection rule (audit / SDK override).
   * Industry: sector / subsector. Style: SMB / HML.
   */
  l2_sector_er: (number | null)[];
  l3_subsector_er: (number | null)[];
  threshold_used: number;
  market_factor_etf: string;
  universe: string;
  data_source: string;
}

export interface GetLstarOptions {
  years?: number;
  threshold?: number;
  axis?: LstarAxis;
}

const INDUSTRY_KEYS: V3MetricKey[] = [
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
  // Materialized canonical pick (SSOT for industry @ default θ): the level ERM3
  // shipped (GBM once enabled) + its dispatched residual return.
  "lstar_level",
  "lstar_rr",
];

const STYLE_KEYS: V3MetricKey[] = [
  "l1_mkt_hr",
  "l2_ff_mkt_hr",
  "l2_ff_smb_hr",
  "l3_ff_mkt_hr",
  "l3_ff_smb_hr",
  "l3_ff_hml_hr",
  "l1_mkt_er",
  "l2_ff_smb_er",
  "l3_ff_smb_er",
  "l3_ff_hml_er",
  "l1_rr",
  "l2_ff_smb_rr",
  "l3_ff_smb_hml_rr",
];

/**
 * Pick cascade depth from marginal explained-risk at L2 and L3.
 *
 * @param l2MarginalEr Industry: `L2_sector_ER`. Style: `L2_ff_smb_ER`.
 * @param l3MarginalEr Industry: `L3_subsector_ER`. Style: `L3_ff_hml_ER`.
 * @param threshold    Marginal ER bar (default 1%).
 * @param axis         Documents input semantics; rule is identical (negative
 *                     marginal ER fails the bar and steps down).
 */
export function pickLstar(
  l2MarginalEr: number | null,
  l3MarginalEr: number | null,
  threshold: number,
  axis: LstarAxis = "industry",
): LstarLevel | null {
  void axis;
  if (l2MarginalEr == null && l3MarginalEr == null) return null;
  if (l3MarginalEr != null && l3MarginalEr >= threshold) return "L3";
  if (l2MarginalEr != null && l2MarginalEr >= threshold) return "L2";
  return "L1";
}

/** Residual return at the chosen industry Lstar level. */
export function dispatchLstarResidualReturn(
  chosen: LstarLevel | null,
  row: PivotedHistoryRow,
): number | null {
  if (chosen === "L3") return extractMetric(row, "l3_rr");
  if (chosen === "L2") return extractMetric(row, "l2_rr");
  if (chosen === "L1") return extractMetric(row, "l1_rr");
  return null;
}

/** Residual return at the chosen style Lstar level. */
export function dispatchStyleLstarResidualReturn(
  chosen: LstarLevel | null,
  row: PivotedHistoryRow,
): number | null {
  if (chosen === "L3") return extractMetric(row, "l3_ff_smb_hml_rr");
  if (chosen === "L2") return extractMetric(row, "l2_ff_smb_rr");
  if (chosen === "L1") return extractMetric(row, "l1_rr");
  return null;
}

/** Map the materialized `lstar_level` uint (1/2/3, 0/null = no rec) to LstarLevel. */
export function materializedLevelToLstar(
  lvl: number | null | undefined,
): LstarLevel | null {
  if (lvl == null) return null;
  const r = Math.round(lvl);
  return r >= 1 && r <= 3 ? (`L${r}` as LstarLevel) : null;
}

function processIndustryRow(
  p: PivotedHistoryRow,
  threshold: number,
  useMaterialized: boolean = true,
): {
  chosen: LstarLevel | null;
  l2Marginal: number | null;
  l3Marginal: number | null;
  market_hr: number | null;
  sector_hr: number | null;
  subsector_hr: number | null;
  total_er: number | null;
  residual_return: number | null;
} {
  const l2Marginal = (p.l2_sec_er as number | null) ?? null;
  const l3Marginal = (p.l3_sub_er as number | null) ?? null;
  // SSOT: when the materialized canonical level is present, it wins (carries the
  // shipped selector — GBM or 1%). Fall back to the live θ rule otherwise.
  const lvlRaw = p.lstar_level as number | null | undefined;
  const fromMaterialized = useMaterialized && lvlRaw !== null && lvlRaw !== undefined;
  const chosen = fromMaterialized
    ? materializedLevelToLstar(lvlRaw)
    : pickLstar(l2Marginal, l3Marginal, threshold, "industry");
  // Materialized residual return is the dispatched lstar_rr (== l{level}_rr).
  const residualReturn = fromMaterialized
    ? ((p.lstar_rr as number | null) ?? dispatchLstarResidualReturn(chosen, p))
    : dispatchLstarResidualReturn(chosen, p);

  if (chosen === "L3") {
    const m = (p.l3_mkt_er as number | null) ?? 0;
    const s = (p.l3_sec_er as number | null) ?? 0;
    const ss = l3Marginal ?? 0;
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l3_mkt_hr as number | null) ?? null,
      sector_hr: (p.l3_sec_hr as number | null) ?? null,
      subsector_hr: (p.l3_sub_hr as number | null) ?? null,
      total_er: m + s + ss,
      residual_return: residualReturn,
    };
  }
  if (chosen === "L2") {
    const m = (p.l2_mkt_er as number | null) ?? 0;
    const s = l2Marginal ?? 0;
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l2_mkt_hr as number | null) ?? null,
      sector_hr: (p.l2_sec_hr as number | null) ?? null,
      subsector_hr: null,
      total_er: m + s,
      residual_return: residualReturn,
    };
  }
  if (chosen === "L1") {
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l1_mkt_hr as number | null) ?? null,
      sector_hr: null,
      subsector_hr: null,
      total_er: (p.l1_mkt_er as number | null) ?? null,
      residual_return: residualReturn,
    };
  }
  return {
    chosen,
    l2Marginal,
    l3Marginal,
    market_hr: null,
    sector_hr: null,
    subsector_hr: null,
    total_er: null,
    residual_return: null,
  };
}

function processStyleRow(
  p: PivotedHistoryRow,
  threshold: number,
): {
  chosen: LstarLevel | null;
  l2Marginal: number | null;
  l3Marginal: number | null;
  market_hr: number | null;
  sector_hr: number | null;
  subsector_hr: number | null;
  total_er: number | null;
  residual_return: number | null;
} {
  const l2Marginal = (p.l2_ff_smb_er as number | null) ?? null;
  const l3Marginal = (p.l3_ff_hml_er as number | null) ?? null;
  const chosen = pickLstar(l2Marginal, l3Marginal, threshold, "style");

  if (chosen === "L3") {
    const m = (p.l1_mkt_er as number | null) ?? 0;
    const smb = (p.l3_ff_smb_er as number | null) ?? 0;
    const hml = l3Marginal ?? 0;
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l3_ff_mkt_hr as number | null) ?? null,
      sector_hr: (p.l3_ff_smb_hr as number | null) ?? null,
      subsector_hr: (p.l3_ff_hml_hr as number | null) ?? null,
      total_er: m + smb + hml,
      residual_return: dispatchStyleLstarResidualReturn(chosen, p),
    };
  }
  if (chosen === "L2") {
    const m = (p.l1_mkt_er as number | null) ?? 0;
    const smb = l2Marginal ?? 0;
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l2_ff_mkt_hr as number | null) ?? null,
      sector_hr: (p.l2_ff_smb_hr as number | null) ?? null,
      subsector_hr: null,
      total_er: m + smb,
      residual_return: dispatchStyleLstarResidualReturn(chosen, p),
    };
  }
  if (chosen === "L1") {
    return {
      chosen,
      l2Marginal,
      l3Marginal,
      market_hr: (p.l1_mkt_hr as number | null) ?? null,
      sector_hr: null,
      subsector_hr: null,
      total_er: (p.l1_mkt_er as number | null) ?? null,
      residual_return: dispatchStyleLstarResidualReturn(chosen, p),
    };
  }
  return {
    chosen,
    l2Marginal,
    l3Marginal,
    market_hr: null,
    sector_hr: null,
    subsector_hr: null,
    total_er: null,
    residual_return: null,
  };
}

export class LstarService {
  /**
   * Resolve Lstar + dispatched hedge ratios for a ticker across a daily window.
   *
   * @param options.axis  `industry` (default) or `style` (Fama–French cascade).
   */
  async getLstar(
    ticker: string,
    marketFactorEtf: string = "SPY",
    options?: GetLstarOptions,
  ): Promise<LstarResult | null> {
    const upperTicker = ticker.toUpperCase();
    const years = options?.years ?? 1;
    const threshold = options?.threshold ?? LSTAR_DEFAULT_THRESHOLD;
    const axis = options?.axis ?? "industry";

    const symbolRecord = await resolveSymbolByTicker(upperTicker);
    if (!symbolRecord) return null;

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const startDateStr = startDate.toISOString().split("T")[0]!;

    const keys = axis === "style" ? STYLE_KEYS : INDUSTRY_KEYS;

    const rows = await fetchHistory(symbolRecord.symbol, keys, {
      periodicity: "daily",
      startDate: startDateStr,
      orderBy: "asc",
    });

    if (rows.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, threshold, axis);
    }

    const pivoted = pivotHistory(rows);
    if (pivoted.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, threshold, axis);
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

    // Prefer the materialized canonical level only for industry @ default θ.
    // An explicit caller θ (or the style axis) keeps live derivation.
    const useMaterialized = axis !== "style" && options?.threshold === undefined;

    for (const p of pivoted) {
      const row =
        axis === "style"
          ? processStyleRow(p, threshold)
          : processIndustryRow(p, threshold, useMaterialized);
      lstar.push(row.chosen);
      l2_sector_er.push(row.l2Marginal);
      l3_subsector_er.push(row.l3Marginal);
      market_hr.push(row.market_hr);
      sector_hr.push(row.sector_hr);
      subsector_hr.push(row.subsector_hr);
      total_er.push(row.total_er);
      residual_return.push(row.residual_return);
    }

    return {
      ticker: upperTicker,
      axis,
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
    axis: LstarAxis,
  ): LstarResult {
    return {
      ticker,
      axis,
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
