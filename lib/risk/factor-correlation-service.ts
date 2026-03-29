/**
 * On-demand Pearson/Spearman correlation between stock return series (gross or ERM3 residual)
 * and macro factor returns stored in `macro_factors`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TTL, generateCacheKey, getOrCompute } from "@/lib/cache/redis";
import {
  fetchBatchHistory,
  pivotHistory,
  resolveSymbolByTicker,
  type PivotedHistoryRow,
  type SecurityHistoryRow,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import {
  DEFAULT_MACRO_FACTORS,
  normalizeMacroFactorKeys,
  type MacroFactorKey,
} from "@/lib/risk/macro-factor-keys";

export { DEFAULT_MACRO_FACTORS };
export type { MacroFactorKey };

export type StockReturnType = "gross" | "l1" | "l2" | "l3_residual";

export interface FactorCorrelationParams {
  ticker: string;
  factors: string[];
  return_type: StockReturnType;
  window_days: number;
  method: "pearson" | "spearman";
}

export interface FactorCorrelationResult {
  ticker: string;
  return_type: StockReturnType;
  window_days: number;
  method: "pearson" | "spearman";
  correlations: Record<string, number | null>;
  overlap_days: number;
  warnings: string[];
}

const MARKET_ETF = "SPY";
const MIN_POINTS = 30;

function groupHistoryBySymbol(rows: SecurityHistoryRow[]): Map<string, SecurityHistoryRow[]> {
  const m = new Map<string, SecurityHistoryRow[]>();
  for (const r of rows) {
    if (!m.has(r.symbol)) m.set(r.symbol, []);
    m.get(r.symbol)!.push(r);
  }
  return m;
}

function toTeoMap(pivoted: PivotedHistoryRow[]): Map<string, PivotedHistoryRow> {
  const map = new Map<string, PivotedHistoryRow>();
  for (const r of pivoted) map.set(r.teo, r);
  return map;
}

function keysForStockReturnType(rt: StockReturnType): V3MetricKey[] {
  const base: V3MetricKey[] = ["returns_gross"];
  switch (rt) {
    case "gross":
      return base;
    case "l1":
      return [...base, "l1_mkt_hr"];
    case "l2":
      return [...base, "l2_mkt_hr", "l2_sec_hr"];
    case "l3_residual":
      return [...base, "l3_mkt_hr", "l3_sec_hr", "l3_sub_hr"];
    default:
      return base;
  }
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < MIN_POINTS) return null;
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return null;
  return num / Math.sqrt(denA * denB);
}

/** Average ranks for ties (1-based). */
function rankWithTies(values: number[]): number[] {
  const n = values.length;
  const order = values.map((v, i) => ({ v, i }));
  order.sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].v === order[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < MIN_POINTS) return null;
  return pearson(rankWithTies(a), rankWithTies(b));
}

function correlationFromArrays(
  a: number[],
  b: number[],
  method: "pearson" | "spearman",
): number | null {
  return method === "spearman" ? spearman(a, b) : pearson(a, b);
}

function normalizeTeo(teo: string): string {
  return teo.includes("T") ? teo.split("T")[0]! : teo;
}

function computeDailyStockReturns(
  returnType: StockReturnType,
  stock: Map<string, PivotedHistoryRow>,
  spy: Map<string, PivotedHistoryRow>,
  sector: Map<string, PivotedHistoryRow> | null,
  sub: Map<string, PivotedHistoryRow> | null,
): { teo: string; r: number }[] {
  const out: { teo: string; r: number }[] = [];
  const teos = [...stock.keys()].sort();
  for (const teo of teos) {
    const s = stock.get(teo);
    if (!s) continue;
    const rg = s.returns_gross;
    if (rg == null || typeof rg !== "number" || Number.isNaN(rg)) continue;

    if (returnType === "gross") {
      out.push({ teo, r: rg });
      continue;
    }

    const rSpy = spy.get(teo)?.returns_gross;
    if (rSpy == null || typeof rSpy !== "number") continue;

    if (returnType === "l1") {
      const hm = s.l1_mkt_hr;
      if (typeof hm !== "number") continue;
      out.push({ teo, r: rg - hm * rSpy });
      continue;
    }

    if (!sector) continue;
    const rSec = sector.get(teo)?.returns_gross;
    if (rSec == null || typeof rSec !== "number") continue;

    if (returnType === "l2") {
      const hm = s.l2_mkt_hr;
      const hs = s.l2_sec_hr;
      if (typeof hm !== "number" || typeof hs !== "number") continue;
      out.push({ teo, r: rg - (hm * rSpy + hs * rSec) });
      continue;
    }

    if (!sub) continue;
    const rSub = sub.get(teo)?.returns_gross;
    if (rSub == null || typeof rSub !== "number") continue;

    const hm = s.l3_mkt_hr;
    const hs = s.l3_sec_hr;
    const hu = s.l3_sub_hr;
    if (typeof hm !== "number" || typeof hs !== "number" || typeof hu !== "number") continue;
    out.push({ teo, r: rg - (hm * rSpy + hs * rSec + hu * rSub) });
  }
  return out;
}

async function loadMacroFactorMaps(
  factorKeys: string[],
  startDate: string,
): Promise<Map<string, Map<string, number>>> {
  const keysForDb = normalizeMacroFactorKeys(factorKeys).keys;
  if (keysForDb.length === 0) {
    return new Map();
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("macro_factors")
    .select("factor_key, teo, return_gross")
    .in("factor_key", keysForDb)
    .gte("teo", startDate)
    .order("teo", { ascending: true });

  if (error) {
    console.error("[macro_factors] query error:", error);
    return new Map();
  }

  const out = new Map<string, Map<string, number>>();
  for (const row of data ?? []) {
    const fk = row.factor_key as string;
    const rawTeo = row.teo as string;
    const teo = normalizeTeo(rawTeo);
    const v = row.return_gross;
    if (v == null || typeof v !== "number") continue;
    if (!out.has(fk)) out.set(fk, new Map());
    out.get(fk)!.set(teo, v);
  }
  return out;
}

export async function getMacroFactorMapsCached(
  factorKeys: string[],
  startDate: string,
): Promise<Map<string, Map<string, number>>> {
  const sorted = normalizeMacroFactorKeys(factorKeys).keys.sort();
  const key = generateCacheKey("macro_factors", "v1", {
    start: startDate,
    f: sorted.join(","),
  });
  return getOrCompute(
    key,
    () => loadMacroFactorMaps(sorted, startDate),
    CACHE_TTL.DAILY,
  );
}

export async function computeFactorCorrelation(
  params: FactorCorrelationParams,
): Promise<FactorCorrelationResult | { error: string; status: number }> {
  const ticker = params.ticker.trim().toUpperCase();
  const warnings: string[] = [];

  const factorSource = params.factors?.length ? params.factors : [...DEFAULT_MACRO_FACTORS];
  const { keys: factorsCanon, warnings: factorNormWarnings } = normalizeMacroFactorKeys(factorSource);
  warnings.push(...factorNormWarnings);
  if (factorsCanon.length === 0) {
    return {
      error: "No valid macro factor keys (check spelling; DB uses lowercase e.g. bitcoin, vix)",
      status: 400,
    };
  }

  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) {
    return { error: "Ticker not found", status: 404 };
  }

  const sectorTicker = symbolRecord.sector_etf?.trim().toUpperCase() ?? null;
  const subTicker = symbolRecord.subsector_etf?.trim().toUpperCase() ?? null;

  if (params.return_type === "l2" || params.return_type === "l3_residual") {
    if (!sectorTicker) {
      return {
        error: "Missing sector_etf on symbol; cannot compute L2/L3 residual returns",
        status: 400,
      };
    }
  }
  if (params.return_type === "l3_residual" && !subTicker) {
    return {
      error: "Missing subsector_etf on symbol; cannot compute L3 residual returns",
      status: 400,
    };
  }

  const spyRecord = await resolveSymbolByTicker(MARKET_ETF);
  if (!spyRecord) {
    return { error: "Market factor ETF not in symbol registry", status: 500 };
  }

  const sectorRecord = sectorTicker ? await resolveSymbolByTicker(sectorTicker) : null;
  const subRecord = subTicker ? await resolveSymbolByTicker(subTicker) : null;

  if ((params.return_type === "l2" || params.return_type === "l3_residual") && !sectorRecord) {
    return { error: `Sector ETF ${sectorTicker} not in symbol registry`, status: 400 };
  }
  if (params.return_type === "l3_residual" && !subRecord) {
    return { error: `Subsector ETF ${subTicker} not in symbol registry`, status: 400 };
  }

  const calendarDays = Math.min(4000, Math.ceil(params.window_days * 1.8));
  const start = new Date();
  start.setDate(start.getDate() - calendarDays);
  const startDateStr = start.toISOString().split("T")[0]!;

  const stockKeys = keysForStockReturnType(params.return_type);
  const symbols: string[] = [symbolRecord.symbol, spyRecord.symbol];
  if (sectorRecord) symbols.push(sectorRecord.symbol);
  if (subRecord) symbols.push(subRecord.symbol);

  const rows = await fetchBatchHistory(symbols, stockKeys, {
    periodicity: "daily",
    startDate: startDateStr,
    orderBy: "asc",
  });

  if (rows.length === 0) {
    return { error: "No security history for requested window", status: 404 };
  }

  const bySym = groupHistoryBySymbol(rows);
  const stockMap = toTeoMap(pivotHistory(bySym.get(symbolRecord.symbol) ?? []));
  const spyMap = toTeoMap(pivotHistory(bySym.get(spyRecord.symbol) ?? []));
  const sectorMap = sectorRecord
    ? toTeoMap(pivotHistory(bySym.get(sectorRecord.symbol) ?? []))
    : null;
  const subMap = subRecord ? toTeoMap(pivotHistory(bySym.get(subRecord.symbol) ?? [])) : null;

  const stockSeries = computeDailyStockReturns(
    params.return_type,
    stockMap,
    spyMap,
    sectorMap,
    subMap,
  );

  if (stockSeries.length < MIN_POINTS) {
    return {
      error: "Insufficient overlapping stock return observations for correlation",
      status: 404,
    };
  }

  const macroMaps = await getMacroFactorMapsCached(factorsCanon, startDateStr);
  if (macroMaps.size === 0) {
    warnings.push(
      "No rows in macro_factors for this date range — ingest macro factor returns to populate correlations.",
    );
  }

  const correlations: Record<string, number | null> = {};
  let maxOverlap = 0;

  for (const factor of factorsCanon) {
    const m = macroMaps.get(factor);
    if (!m || m.size === 0) {
      correlations[factor] = null;
      continue;
    }

    const pairs: { s: number; f: number }[] = [];
    for (const { teo, r } of stockSeries) {
      const mv = m.get(teo);
      if (mv != null && typeof mv === "number" && !Number.isNaN(mv)) {
        pairs.push({ s: r, f: mv });
      }
    }

    if (pairs.length < MIN_POINTS) {
      correlations[factor] = null;
      continue;
    }

    const slice = pairs.slice(-params.window_days);
    maxOverlap = Math.max(maxOverlap, slice.length);
    const sx = slice.map((p) => p.s);
    const fx = slice.map((p) => p.f);
    correlations[factor] = correlationFromArrays(sx, fx, params.method);
  }

  return {
    ticker: symbolRecord.ticker,
    return_type: params.return_type,
    window_days: params.window_days,
    method: params.method,
    correlations,
    overlap_days: maxOverlap,
    warnings,
  };
}

export type FactorCorrelationBatchItem =
  | FactorCorrelationResult
  | { ticker: string; error: string; status: number };

export async function computeFactorCorrelationBatch(
  tickers: string[],
  rest: Omit<FactorCorrelationParams, "ticker">,
): Promise<{ results: FactorCorrelationBatchItem[] }> {
  const results: FactorCorrelationBatchItem[] = await Promise.all(
    tickers.map(async (t) => {
      const r = await computeFactorCorrelation({ ...rest, ticker: t });
      if ("error" in r && "status" in r) {
        return { ticker: t.trim().toUpperCase(), error: r.error, status: r.status };
      }
      return r;
    }),
  );
  return { results };
}
