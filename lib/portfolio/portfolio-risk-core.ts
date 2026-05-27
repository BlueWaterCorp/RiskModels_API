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
import { DEFAULT_USER_SEGMENT } from "@/lib/dal/hedge-recommendation";
import { computeHedgeRecommendationSnapshot } from "@/lib/risk/hedge-recommendation-service";
import {
  aggregatePortfolioHedgeLevels,
  buildHedgeLevels,
  type HedgeLevelsBlock,
} from "@/lib/risk/hedge-levels";

export const L3_ER_KEYS: V3MetricKey[] = [
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
];

/** Full L1/L2/L3 hedge scalars + L3 ER for portfolio snapshots / hedge_levels. */
const PORTFOLIO_HEDGE_LEVEL_KEYS: V3MetricKey[] = [
  "l1_mkt_hr",
  "l1_mkt_er",
  "l1_res_er",
  "l2_mkt_hr",
  "l2_sec_hr",
  "l2_mkt_er",
  "l2_sec_er",
  "l2_res_er",
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
];

/** Lstar pair carried through every portfolio compute so the per-row payload
 *  and the parallel `lstar_attribution` block both have what they need. The
 *  per-row `lstar_rr` is the dispatched residual *return* (a scalar from
 *  MetricsV3); the portfolio-level Lstar attribution dispatches L1/L2/L3 ERs
 *  per name based on each name's `lstar_level`. */
const LSTAR_KEYS: V3MetricKey[] = ["lstar_rr", "lstar_level"];

const EXTRA_METRIC_KEYS: V3MetricKey[] = ["vol_23d", "price_close", ...LSTAR_KEYS];

function metricKeys(includeHedgeRatios: boolean): V3MetricKey[] {
  if (includeHedgeRatios) {
    return [...PORTFOLIO_HEDGE_LEVEL_KEYS, ...EXTRA_METRIC_KEYS];
  }
  return [...L3_ER_KEYS, ...EXTRA_METRIC_KEYS];
}

/** Per-name dispatch table: for one name's `lstar_level`, return that
 *  cascade depth's market/sector/subsector/residual ER (sourced from
 *  L1_ / L2_ / L3_ keys in MetricsV3). null lstar → null (caller drops the
 *  name from the Lstar aggregate; coverage block surfaces the drop). */
function dispatchedERForLstar(
  er: Record<string, number | null>,
  lstarLevel: number | null,
): {
  market: number;
  sector: number;
  subsector: number;
  residual: number;
} | null {
  if (lstarLevel == null) return null;
  const lvl = Math.round(lstarLevel);
  if (lvl === 1) {
    return {
      market: er.l1_mkt_er ?? 0,
      sector: 0,
      subsector: 0,
      residual: er.l1_res_er ?? 0,
    };
  }
  if (lvl === 2) {
    return {
      market: er.l2_mkt_er ?? 0,
      sector: er.l2_sec_er ?? 0,
      subsector: 0,
      residual: er.l2_res_er ?? 0,
    };
  }
  if (lvl === 3) {
    return {
      market: er.l3_mkt_er ?? 0,
      sector: er.l3_sec_er ?? 0,
      subsector: er.l3_sub_er ?? 0,
      residual: er.l3_res_er ?? 0,
    };
  }
  return null;
}

export interface PortfolioLstarAttribution {
  market: number;
  sector: number;
  subsector: number;
  residual: number;
  /** Sum of weights for names that contributed to the Lstar aggregate (had a
   *  non-null `lstar_level` AND `includeHedgeRatios` was true so L1/L2 ERs
   *  were fetched). Compare against 1.0 to gauge how representative the
   *  Lstar attribution is for the portfolio. */
  weight_covered: number;
  /** Count of names dropped from the Lstar aggregate due to null lstar_level. */
  dropped_count: number;
}

export function computePortfolioLstarAttribution(
  tickerMetrics: Map<string, Record<string, number | null>>,
  weights: Map<string, number>,
): PortfolioLstarAttribution {
  let market = 0;
  let sector = 0;
  let subsector = 0;
  let residual = 0;
  let weightCovered = 0;
  let droppedCount = 0;

  for (const [ticker, w] of weights) {
    const er = tickerMetrics.get(ticker);
    if (!er) {
      droppedCount += 1;
      continue;
    }
    const dispatched = dispatchedERForLstar(
      er,
      (er.lstar_level as number | null) ?? null,
    );
    if (!dispatched) {
      droppedCount += 1;
      continue;
    }
    market += w * dispatched.market;
    sector += w * dispatched.sector;
    subsector += w * dispatched.subsector;
    residual += w * dispatched.residual;
    weightCovered += w;
  }

  return { market, sector, subsector, residual, weight_covered: weightCovered, dropped_count: droppedCount };
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
  /** Holdings-weighted mean HR/ER per L1/L2/L3 when `includeHedgeRatios` was true. */
  portfolio_hedge_levels?: HedgeLevelsBlock;
  /** Parallel Lstar-dispatched attribution — for each name, picks the ER at
   *  the cascade depth `lstar_level` chose, then weights across the book.
   *  Populated only when `includeHedgeRatios` was true (otherwise L1/L2 ERs
   *  weren't fetched). Names with null `lstar_level` are dropped; see
   *  `weight_covered` and `dropped_count` for coverage. The existing
   *  fixed-L3 `portfolioER` is unchanged — the Lstar attribution runs
   *  alongside, not as a replacement. */
  lstar_attribution?: PortfolioLstarAttribution;
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
      // Lstar-dispatched residual return + level pick. Surfaced on every
      // per-row payload (cheap — already in MetricsV3); the portfolio-level
      // Lstar-aware attribution further down uses these to dispatch ERs.
      lstar_rr: m?.lstar_rr ?? null,
      lstar_level: m?.lstar_level ?? null,
    };
    if (options.includeHedgeRatios && m) {
      row.l1_mkt_hr = m.l1_mkt_hr ?? null;
      row.l1_mkt_er = m.l1_mkt_er ?? null;
      row.l1_res_er = m.l1_res_er ?? null;
      row.l2_mkt_hr = m.l2_mkt_hr ?? null;
      row.l2_sec_hr = m.l2_sec_hr ?? null;
      row.l2_mkt_er = m.l2_mkt_er ?? null;
      row.l2_sec_er = m.l2_sec_er ?? null;
      row.l2_res_er = m.l2_res_er ?? null;
      row.l3_mkt_hr = m.l3_mkt_hr ?? null;
      row.l3_sec_hr = m.l3_sec_hr ?? null;
      row.l3_sub_hr = m.l3_sub_hr ?? null;

      const hedgeSnap = computeHedgeRecommendationSnapshot({
        l1_mkt_hr: row.l1_mkt_hr as number | null,
        l2_mkt_hr: row.l2_mkt_hr as number | null,
        l2_sec_hr: row.l2_sec_hr as number | null,
        l3_mkt_hr: row.l3_mkt_hr as number | null,
        l3_sec_hr: row.l3_sec_hr as number | null,
        l3_sub_hr: row.l3_sub_hr as number | null,
        l2_sec_er: row.l2_sec_er as number | null,
        l3_sub_er: m.l3_sub_er ?? null,
        user_segment: DEFAULT_USER_SEGMENT,
      });

      row.hedge_levels = buildHedgeLevels(m, {
        market_etf: "SPY",
        sector_etf: sym.sector_etf ?? null,
        subsector_etf: sym.subsector_etf ?? sym.sector_etf ?? null,
      }, {
        recommended_level: hedgeSnap.recommended_hedge_level,
        statistical_lstar: hedgeSnap.lstar,
      });
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

  let portfolio_hedge_levels: HedgeLevelsBlock | undefined;
  let lstar_attribution: PortfolioLstarAttribution | undefined;
  if (options.includeHedgeRatios) {
    const weightsObj = Object.fromEntries(weightMap);
    const blocksByTicker: Record<string, HedgeLevelsBlock> = {};
    for (const t of resolvedTickers) {
      const hl = perTicker[t]?.hedge_levels as HedgeLevelsBlock | undefined;
      if (hl) blocksByTicker[t] = hl;
    }
    portfolio_hedge_levels = aggregatePortfolioHedgeLevels(weightsObj, blocksByTicker);
    // Lstar-aware variance attribution runs alongside the fixed-L3
    // `portfolioER` — both are reported so callers can compare. Only
    // populated when includeHedgeRatios=true because that's when the
    // L1/L2 ERs (needed for dispatch on names where lstar_level < 3)
    // are actually fetched.
    lstar_attribution = computePortfolioLstarAttribution(tickerMetrics, weightMap);
  }

  return {
    status: "ok",
    fetchLatencyMs,
    portfolioER,
    systematic,
    portfolioVol,
    portfolio_hedge_levels,
    lstar_attribution,
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
