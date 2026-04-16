/**
 * Shared portfolio L3 variance decomposition (used by /portfolio/risk-index and /portfolio/risk-snapshot).
 * Calls DAL directly — no internal HTTP — so callers are not double-billed.
 */

import {
  fetchLatestMetricsWithFallback,
  fetchBatchHistory,
  resolveSymbolsByTickers,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";

export const L3_ER_KEYS: V3MetricKey[] = [
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
];

const L3_HR_KEYS: V3MetricKey[] = ["l3_mkt_hr", "l3_sec_hr", "l3_sub_hr"];

const EXTRA_METRIC_KEYS: V3MetricKey[] = ["vol_23d", "price_close"];

function metricKeys(includeHedgeRatios: boolean): V3MetricKey[] {
  if (includeHedgeRatios) {
    return [...L3_ER_KEYS, ...L3_HR_KEYS, ...EXTRA_METRIC_KEYS];
  }
  return [...L3_ER_KEYS, ...EXTRA_METRIC_KEYS];
}

export function normalizeWeights(
  positions: { ticker: string; weight: number }[],
): { ticker: string; weight: number }[] {
  const sum = positions.reduce((acc, p) => acc + p.weight, 0);
  if (sum === 0) return positions;
  return positions.map((p) => ({ ticker: p.ticker, weight: p.weight / sum }));
}

export function computePortfolioER(
  tickerERs: Map<string, Record<string, number | null>>,
  weights: Map<string, number>,
): { market: number; sector: number; subsector: number; residual: number } {
  let market = 0;
  let sector = 0;
  let subsector = 0;
  let residual = 0;

  for (const [ticker, w] of weights) {
    const er = tickerERs.get(ticker);
    if (!er) continue;
    market += w * (er.l3_mkt_er ?? 0);
    sector += w * (er.l3_sec_er ?? 0);
    subsector += w * (er.l3_sub_er ?? 0);
    residual += w * (er.l3_res_er ?? 0);
  }

  return { market, sector, subsector, residual };
}

export function computePortfolioVolatility(
  tickerMetrics: Map<string, Record<string, number | null>>,
  weights: Map<string, number>,
): number | null {
  let totalVol = 0;
  let hasAny = false;

  for (const [ticker, w] of weights) {
    const m = tickerMetrics.get(ticker);
    const vol = m?.vol_23d;
    if (vol != null) {
      totalVol += w * vol;
      hasAny = true;
    }
  }

  return hasAny ? totalVol : null;
}

export type PortfolioRiskComputationOk = {
  status: "ok";
  fetchLatencyMs: number;
  portfolioER: ReturnType<typeof computePortfolioER>;
  systematic: number;
  portfolioVol: number | null;
  perTicker: Record<string, Record<string, unknown>>;
  summary: {
    total_positions: number;
    resolved: number;
    errors: number;
  };
  errorsList: { ticker: string; error: string }[];
  timeSeriesData?: Array<{
    date: string;
    market_er: number;
    sector_er: number;
    subsector_er: number;
    residual_er: number;
    systematic_er: number;
  }>;
};

export type PortfolioRiskComputationResult =
  | { status: "syncing" }
  | {
      status: "invalid";
      errors: { ticker: string; error: string }[];
    }
  | PortfolioRiskComputationOk;

/**
 * Core PRI-style computation for one or more weighted positions.
 */
export async function runPortfolioRiskComputation(
  positions: { ticker: string; weight: number }[],
  options: {
    timeSeries: boolean;
    years: number;
    includeHedgeRatios: boolean;
  },
): Promise<PortfolioRiskComputationResult> {
  const fetchStart = performance.now();

  if (positions.length === 0) {
    return { status: "syncing" };
  }

  const normalized = normalizeWeights(positions);
  const weightMap = new Map(normalized.map((p) => [p.ticker, p.weight]));
  const tickers = normalized.map((p) => p.ticker);

  const symbolMap = await resolveSymbolsByTickers(tickers);
  const errors: { ticker: string; error: string }[] = [];
  const resolvedTickers: string[] = [];

  for (const ticker of tickers) {
    if (!symbolMap.has(ticker)) {
      errors.push({ ticker, error: `Symbol not found for ticker ${ticker}` });
    } else {
      resolvedTickers.push(ticker);
    }
  }

  if (resolvedTickers.length === 0) {
    return { status: "invalid", errors };
  }

  const keys = metricKeys(options.includeHedgeRatios);
  const tickerMetrics = new Map<string, Record<string, number | null>>();
  const tickerTeos = new Map<string, string>();

  await Promise.all(
    resolvedTickers.map(async (ticker) => {
      const sym = symbolMap.get(ticker)!;
      const result = await fetchLatestMetricsWithFallback(sym.symbol, keys, "daily");
      if (result) {
        tickerMetrics.set(ticker, result.metrics);
        tickerTeos.set(ticker, result.teo);
      }
    }),
  );

  const portfolioER = computePortfolioER(tickerMetrics, weightMap);
  const systematic = portfolioER.market + portfolioER.sector + portfolioER.subsector;
  const portfolioVol = computePortfolioVolatility(tickerMetrics, weightMap);

  const perTicker: Record<string, Record<string, unknown>> = {};
  for (const ticker of resolvedTickers) {
    const m = tickerMetrics.get(ticker);
    const sym = symbolMap.get(ticker)!;
    const row: Record<string, unknown> = {
      weight: weightMap.get(ticker),
      symbol: sym.symbol,
      teo: tickerTeos.get(ticker) ?? null,
      sector_etf: sym.sector_etf ?? null,
      subsector_etf: sym.subsector_etf ?? null,
      l3_mkt_er: m?.l3_mkt_er ?? null,
      l3_sec_er: m?.l3_sec_er ?? null,
      l3_sub_er: m?.l3_sub_er ?? null,
      l3_res_er: m?.l3_res_er ?? null,
      vol_23d: m?.vol_23d ?? null,
      price_close: m?.price_close ?? null,
    };
    if (options.includeHedgeRatios) {
      row.l3_mkt_hr = m?.l3_mkt_hr ?? null;
      row.l3_sec_hr = m?.l3_sec_hr ?? null;
      row.l3_sub_hr = m?.l3_sub_hr ?? null;
    }
    perTicker[ticker] = row;
  }

  let timeSeriesData: PortfolioRiskComputationOk["timeSeriesData"];
  if (options.timeSeries) {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - options.years);

    const symbols = resolvedTickers.map((t) => symbolMap.get(t)!.symbol);
    const rows = await fetchBatchHistory(symbols, L3_ER_KEYS, {
      periodicity: "daily",
      startDate: startDate.toISOString().split("T")[0],
      orderBy: "asc",
    });

    const byDate = new Map<string, Map<string, Record<string, number | null>>>();
    for (const row of rows) {
      if (!byDate.has(row.teo)) byDate.set(row.teo, new Map());
      const dateMap = byDate.get(row.teo)!;
      const ticker = resolvedTickers.find((t) => symbolMap.get(t)?.symbol === row.symbol);
      if (!ticker) continue;
      if (!dateMap.has(ticker)) dateMap.set(ticker, {});
      dateMap.get(ticker)![row.metric_key] = row.metric_value;
    }

    timeSeriesData = [];
    for (const [date, dateMap] of byDate) {
      const dayER = computePortfolioER(dateMap, weightMap);
      timeSeriesData.push({
        date,
        market_er: dayER.market,
        sector_er: dayER.sector,
        subsector_er: dayER.subsector,
        residual_er: dayER.residual,
        systematic_er: dayER.market + dayER.sector + dayER.subsector,
      });
    }
  }

  const fetchLatencyMs = Math.round(performance.now() - fetchStart);

  return {
    status: "ok",
    fetchLatencyMs,
    portfolioER,
    systematic,
    portfolioVol,
    perTicker,
    summary: {
      total_positions: tickers.length,
      resolved: resolvedTickers.length,
      errors: errors.length,
    },
    errorsList: errors,
    timeSeriesData,
  };
}
