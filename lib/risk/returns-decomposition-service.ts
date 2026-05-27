/**
 * Returns decomposition service — gross + L1/L2/L3 factor, combined-factor,
 * and residual return series from `ds_erm3_returns_*` (V3 DAL / zarr SSOT).
 *
 * Optional Lstar dispatch (`include_lstar=true`) adds per-date recommended level
 * and Lstar-dispatched residual return. Prefers materialized `lstar_rr` /
 * `lstar_level` from returns zarr when present; falls back to live derivation
 * from marginal ERs (same rule as GET /lstar at the default 1% threshold).
 */

import {
  resolveSymbolByTicker,
  fetchHistory,
  pivotHistory,
  extractMetric,
  type PivotedHistoryRow,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import {
  dispatchLstarResidualReturn,
  pickLstar,
  LSTAR_DEFAULT_THRESHOLD,
  type LstarLevel,
} from "@/lib/risk/lstar-service";

const BASE_KEYS: V3MetricKey[] = [
  "returns_gross",
  "l1_fr",
  "l2_fr",
  "l3_fr",
  "l1_cfr",
  "l2_cfr",
  "l3_cfr",
  "l1_rr",
  "l2_rr",
  "l3_rr",
];

const LSTAR_KEYS: V3MetricKey[] = [
  "l2_sec_er",
  "l3_sub_er",
  "lstar_rr",
  "lstar_level",
];

export interface ReturnsDecompositionResult {
  ticker: string;
  dates: string[];
  returns_gross: (number | null)[];
  l1_fr: (number | null)[];
  l2_fr: (number | null)[];
  l3_fr: (number | null)[];
  l1_cfr: (number | null)[];
  l2_cfr: (number | null)[];
  l3_cfr: (number | null)[];
  l1_rr: (number | null)[];
  l2_rr: (number | null)[];
  l3_rr: (number | null)[];
  lstar?: (LstarLevel | null)[];
  lstar_residual_return?: (number | null)[];
  threshold_used?: number;
  market_factor_etf: string;
  universe: string;
  data_source: string;
}

/** Wire shape with semantic suffixes for REST / OpenAPI. */
export type ReturnsDecompositionPublicBody = {
  ticker: string;
  dates: string[];
  gross_return: (number | null)[];
  l1_factor_return: (number | null)[];
  l2_factor_return: (number | null)[];
  l3_factor_return: (number | null)[];
  l1_combined_factor_return: (number | null)[];
  l2_combined_factor_return: (number | null)[];
  l3_combined_factor_return: (number | null)[];
  l1_residual_return: (number | null)[];
  l2_residual_return: (number | null)[];
  l3_residual_return: (number | null)[];
  lstar?: (LstarLevel | null)[];
  lstar_residual_return?: (number | null)[];
  threshold_used?: number;
  market_factor_etf: string;
  universe: string;
  data_source: string;
};

function levelFromZarrEncoding(raw: number | null | undefined): LstarLevel | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (raw === 1) return "L1";
  if (raw === 2) return "L2";
  if (raw === 3) return "L3";
  return null;
}

function resolveLstarForRow(
  row: PivotedHistoryRow,
  threshold: number,
): { level: LstarLevel | null; residual: number | null } {
  const zarrLevel = levelFromZarrEncoding(
    extractMetric(row, "lstar_level") as number | null | undefined,
  );
  const zarrRr = extractMetric(row, "lstar_rr") as number | null | undefined;

  const level =
    zarrLevel ??
    pickLstar(
      (extractMetric(row, "l2_sec_er") as number | null | undefined) ?? null,
      (extractMetric(row, "l3_sub_er") as number | null | undefined) ?? null,
      threshold,
    );

  const residual =
    zarrRr != null && Number.isFinite(zarrRr)
      ? zarrRr
      : dispatchLstarResidualReturn(level, row);

  return { level, residual };
}

export function toReturnsDecompositionPublicBody(
  r: ReturnsDecompositionResult,
): ReturnsDecompositionPublicBody {
  const body: ReturnsDecompositionPublicBody = {
    ticker: r.ticker,
    dates: r.dates,
    gross_return: r.returns_gross,
    l1_factor_return: r.l1_fr,
    l2_factor_return: r.l2_fr,
    l3_factor_return: r.l3_fr,
    l1_combined_factor_return: r.l1_cfr,
    l2_combined_factor_return: r.l2_cfr,
    l3_combined_factor_return: r.l3_cfr,
    l1_residual_return: r.l1_rr,
    l2_residual_return: r.l2_rr,
    l3_residual_return: r.l3_rr,
    market_factor_etf: r.market_factor_etf,
    universe: r.universe,
    data_source: r.data_source,
  };
  if (r.lstar !== undefined) {
    body.lstar = r.lstar;
    body.lstar_residual_return = r.lstar_residual_return;
    body.threshold_used = r.threshold_used;
  }
  return body;
}

export class ReturnsDecompositionService {
  private emptyResult(
    ticker: string,
    marketFactorEtf: string,
    includeLstar: boolean,
    threshold: number,
  ): ReturnsDecompositionResult {
    const base: ReturnsDecompositionResult = {
      ticker,
      dates: [],
      returns_gross: [],
      l1_fr: [],
      l2_fr: [],
      l3_fr: [],
      l1_cfr: [],
      l2_cfr: [],
      l3_cfr: [],
      l1_rr: [],
      l2_rr: [],
      l3_rr: [],
      market_factor_etf: marketFactorEtf,
      universe: "US_EQUITY",
      data_source: "zarr",
    };
    if (includeLstar) {
      base.lstar = [];
      base.lstar_residual_return = [];
      base.threshold_used = threshold;
    }
    return base;
  }

  async getDecomposition(
    ticker: string,
    marketFactorEtf: string = "SPY",
    options?: { years?: number; includeLstar?: boolean; threshold?: number },
  ): Promise<ReturnsDecompositionResult | null> {
    const upperTicker = ticker.toUpperCase();
    const years = options?.years ?? 1;
    const includeLstar = options?.includeLstar ?? false;
    const threshold = options?.threshold ?? LSTAR_DEFAULT_THRESHOLD;

    const symbolRecord = await resolveSymbolByTicker(upperTicker);
    if (!symbolRecord) return null;

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    const startDateStr = startDate.toISOString().split("T")[0]!;

    const keys: V3MetricKey[] = includeLstar
      ? [...BASE_KEYS, ...LSTAR_KEYS]
      : BASE_KEYS;

    const rows = await fetchHistory(symbolRecord.symbol, keys, {
      periodicity: "daily",
      startDate: startDateStr,
      orderBy: "asc",
    });

    if (rows.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, includeLstar, threshold);
    }

    const pivoted = pivotHistory(rows);
    if (pivoted.length === 0) {
      return this.emptyResult(upperTicker, marketFactorEtf, includeLstar, threshold);
    }

    const dates = pivoted.map((p) => p.teo);
    const result: ReturnsDecompositionResult = {
      ticker: upperTicker,
      dates,
      returns_gross: pivoted.map((p) => extractMetric(p, "returns_gross")),
      l1_fr: pivoted.map((p) => extractMetric(p, "l1_fr")),
      l2_fr: pivoted.map((p) => extractMetric(p, "l2_fr")),
      l3_fr: pivoted.map((p) => extractMetric(p, "l3_fr")),
      l1_cfr: pivoted.map((p) => extractMetric(p, "l1_cfr")),
      l2_cfr: pivoted.map((p) => extractMetric(p, "l2_cfr")),
      l3_cfr: pivoted.map((p) => extractMetric(p, "l3_cfr")),
      l1_rr: pivoted.map((p) => extractMetric(p, "l1_rr")),
      l2_rr: pivoted.map((p) => extractMetric(p, "l2_rr")),
      l3_rr: pivoted.map((p) => extractMetric(p, "l3_rr")),
      market_factor_etf: marketFactorEtf,
      universe: "US_EQUITY",
      data_source: "zarr",
    };

    if (includeLstar) {
      const lstarLevels: (LstarLevel | null)[] = [];
      const lstarResiduals: (number | null)[] = [];
      for (const row of pivoted) {
        const { level, residual } = resolveLstarForRow(row, threshold);
        lstarLevels.push(level);
        lstarResiduals.push(residual);
      }
      result.lstar = lstarLevels;
      result.lstar_residual_return = lstarResiduals;
      result.threshold_used = threshold;
    }

    return result;
  }
}

let _instance: ReturnsDecompositionService | null = null;
export function getReturnsDecompositionService(): ReturnsDecompositionService {
  if (!_instance) {
    _instance = new ReturnsDecompositionService();
  }
  return _instance;
}
