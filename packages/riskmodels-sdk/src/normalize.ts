import type {
  ApiCallMetadata,
  ChartDatum,
  DecompositionComponent,
  LayerExposure,
  RiskLayer,
  RiskModelsResult,
  SuggestedChart,
} from "./types.js";
import {
  aggregatePortfolioHedgeLevels,
  notionalsFromLevelSnapshot,
  type HedgeLevelId,
  type HedgeLevelsBlock,
} from "./hedge-levels-internal.js";

const LAYERS: RiskLayer[] = ["market", "sector", "subsector", "residual"];
const LAYER_LABELS: Record<RiskLayer, string> = {
  market: "Market",
  sector: "Sector",
  subsector: "Subsector",
  residual: "Residual",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataFromRaw(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const metadata = raw._metadata;
  return isRecord(metadata) ? metadata : undefined;
}

function dataAsOfFromRaw(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const direct = str(raw.data_as_of) ?? str(raw.teo);
  if (direct) return direct;
  const metadata = metadataFromRaw(raw);
  return str(metadata?.data_as_of) ?? undefined;
}

function requestIdFromRaw(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const agent = raw._agent;
  return isRecord(agent) ? str(agent.request_id) ?? undefined : undefined;
}

function costFromRaw(raw: unknown): number | undefined {
  if (!isRecord(raw)) return undefined;
  const direct = num(raw._cost_usd);
  if (direct !== null) return direct;
  const agent = raw._agent;
  const cost = isRecord(agent) ? num(agent.cost_usd) : null;
  return cost ?? undefined;
}

export function apiCallWithLineage(
  raw: unknown,
  apiCall: ApiCallMetadata,
): ApiCallMetadata {
  return {
    ...apiCall,
    data_as_of: apiCall.data_as_of ?? dataAsOfFromRaw(raw),
    request_id: apiCall.request_id ?? requestIdFromRaw(raw),
    cost_usd: apiCall.cost_usd ?? costFromRaw(raw),
  };
}

export function exposureFromMetrics(
  metrics: Record<string, unknown>,
  meta?: Record<string, unknown>,
): LayerExposure {
  return {
    market: {
      er: num(metrics.l3_market_er ?? metrics.l3_mkt_er),
      hr: num(metrics.l3_market_hr ?? metrics.l3_mkt_hr),
      hedge_etf: "SPY",
    },
    sector: {
      er: num(metrics.l3_sector_er ?? metrics.l3_sec_er),
      hr: num(metrics.l3_sector_hr ?? metrics.l3_sec_hr),
      hedge_etf: str(meta?.sector_etf),
    },
    subsector: {
      er: num(metrics.l3_subsector_er ?? metrics.l3_sub_er),
      hr: num(metrics.l3_subsector_hr ?? metrics.l3_sub_hr),
      hedge_etf: str(meta?.subsector_etf) ?? str(meta?.sector_etf),
    },
    residual: {
      er: num(metrics.l3_residual_er ?? metrics.l3_res_er),
      hr: null,
      hedge_etf: null,
    },
  };
}

export function componentsFromExposure(
  exposure: LayerExposure,
  ticker?: string,
  dollars?: number,
): DecompositionComponent[] {
  return LAYERS.map((layer) => {
    const item = exposure[layer] ?? {};
    const hedgeRatio = num(item.hr);
    const hedgeNotional =
      dollars !== undefined && layer !== "residual" && hedgeRatio !== null
        ? -hedgeRatio * dollars
        : undefined;
    return {
      ticker,
      layer,
      label: LAYER_LABELS[layer],
      explained_risk: num(item.er),
      hedge_ratio: hedgeRatio,
      hedge_etf: str(item.hedge_etf),
      ...(hedgeNotional !== undefined ? { hedge_notional: hedgeNotional } : {}),
    };
  });
}

export function chartDataFromComponents(
  components: DecompositionComponent[],
  metric: "explained_risk" | "hedge_ratio" | "hedge_notional" = "explained_risk",
): ChartDatum[] {
  return components.map((component) => ({
    label: component.label,
    ticker: component.ticker,
    layer: component.layer,
    metric,
    value: component[metric] ?? null,
    unit:
      metric === "explained_risk"
        ? "fraction"
        : metric === "hedge_notional"
          ? "usd"
          : "dollar_ratio",
    series: component.ticker,
    color_hint: component.layer,
  }));
}

export function plainEnglishForComponents(
  components: DecompositionComponent[],
  fallbackTicker = "This position",
): string {
  const ticker = components.find((component) => component.ticker)?.ticker ?? fallbackTicker;
  const ranked = [...components]
    .filter((component) => component.explained_risk !== null)
    .sort((a, b) => (b.explained_risk ?? 0) - (a.explained_risk ?? 0));
  if (ranked.length === 0) {
    return `${ticker} was decomposed into market, sector, subsector, and residual layers.`;
  }
  const top = ranked[0];
  const pct = ((top.explained_risk ?? 0) * 100).toFixed(1);
  return `${ticker} is primarily a ${top.label.toLowerCase()} bet: ${pct}% of explained variance sits in that layer.`;
}

export function normalizeHedgeLevel(raw: unknown): HedgeLevelId {
  if (raw === undefined || raw === null || raw === "") {
    return "L3";
  }
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : String(raw).trim().toUpperCase();
  if (v === "L1" || v === "L2" || v === "L3") return v;
  throw new Error(`Invalid hedge level "${String(raw)}": expected L1, L2, or L3`);
}

function renormalizeWeights(
  weights: Record<string, number>,
  successfulTickers: string[],
): Record<string, number> {
  const picks = successfulTickers.filter((t) => t in weights);
  const ws: Record<string, number> = Object.fromEntries(picks.map((t) => [t, weights[t]]));
  let sum = Object.values(ws).reduce((acc, cur) => acc + cur, 0);
  if (picks.length === 0 && successfulTickers.length > 0) {
    const u = successfulTickers.length;
    return Object.fromEntries(successfulTickers.map((t) => [t, 1 / u]));
  }
  if (!(sum > 0)) {
    const keys = Object.keys(ws);
    const n = keys.length || 1;
    return Object.fromEntries(keys.map((t) => [t, 1 / n]));
  }
  return Object.fromEntries(Object.entries(ws).map(([t, v]) => [t, v / sum]));
}

export function normalizeDecomposeResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const ticker = str(record.ticker) ?? undefined;
  const exposure = isRecord(record.exposure) ? (record.exposure as unknown as LayerExposure) : {};
  const components = componentsFromExposure(exposure, ticker);
  const hedgeLevelsBlock = isRecord(record.hedge_levels) ? record.hedge_levels : undefined;
  const call = apiCallWithLineage(raw, apiCall);
  return {
    raw,
    normalized: {
      ticker,
      components,
      hedge: isRecord(record.hedge) ? (record.hedge as Record<string, number>) : undefined,
      metadata: {
        ...(metadataFromRaw(raw) ?? {}),
        ...(hedgeLevelsBlock ? { hedge_levels: hedgeLevelsBlock } : {}),
      },
    },
    chart_data: chartDataFromComponents(components),
    suggested_chart: "bar",
    plain_english: plainEnglishForComponents(components, ticker),
    api_call: call,
  };
}

export function normalizeCompareResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const results = isRecord(record.results) ? record.results : {};
  const components: DecompositionComponent[] = [];
  const tickers: string[] = [];
  for (const [key, value] of Object.entries(results)) {
    if (!isRecord(value) || value.status === "error") continue;
    const ticker = str(value.ticker) ?? key.toUpperCase();
    tickers.push(ticker);
    const metrics = isRecord(value.full_metrics) ? value.full_metrics : {};
    const meta = isRecord(value.meta) ? value.meta : undefined;
    components.push(...componentsFromExposure(exposureFromMetrics(metrics, meta), ticker));
  }
  return {
    raw,
    normalized: {
      tickers,
      components,
      metadata: metadataFromRaw(raw),
    },
    chart_data: chartDataFromComponents(components),
    suggested_chart: "grouped_bar",
    plain_english:
      tickers.length > 0
        ? `Compared ${tickers.join(", ")} across market, sector, subsector, and residual risk layers.`
        : "No successful ticker decompositions were returned for comparison.",
    api_call: apiCallWithLineage(raw, apiCall),
  };
}

export function normalizeHedgePositionResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
  dollars: number,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const ticker = str(record.ticker) ?? undefined;
  const exposure = isRecord(record.exposure) ? (record.exposure as unknown as LayerExposure) : {};
  const components = componentsFromExposure(exposure, ticker, dollars);
  const hedgeLevelsBlock = isRecord(record.hedge_levels) ? record.hedge_levels : undefined;
  const chartData = chartDataFromComponents(
    components.filter((component) => component.layer !== "residual"),
    "hedge_notional",
  );
  return {
    raw,
    normalized: {
      ticker,
      components,
      hedge: isRecord(record.hedge) ? (record.hedge as Record<string, number>) : undefined,
      metadata: {
        ...(metadataFromRaw(raw) ?? {}),
        ...(hedgeLevelsBlock ? { hedge_levels: hedgeLevelsBlock } : {}),
      },
    },
    chart_data: chartData,
    suggested_chart: "bar",
    plain_english: `${ticker ?? "This position"} hedge notionals are scaled to a $${dollars.toLocaleString("en-US")} stock position.`,
    api_call: apiCallWithLineage(raw, apiCall),
  };
}

export function normalizeHedgeLevelsResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const ticker = str(record.ticker) ?? undefined;
  const hedgeLevels = isRecord(record.hedge_levels) ? record.hedge_levels : undefined;
  return {
    raw,
    normalized: {
      ticker,
      components: [],
      metadata:
        hedgeLevels !== undefined ? { ...(metadataFromRaw(raw) ?? {}), hedge_levels: hedgeLevels } : metadataFromRaw(raw),
    },
    chart_data: [],
    suggested_chart: "table",
    plain_english: ticker
      ? `${ticker}: L1/L2/L3 hedge_levels from GET /metrics (compare cascade levels).`
      : "L1/L2/L3 hedge_levels from GET /metrics.",
    api_call: apiCallWithLineage(raw, apiCall),
  };
}

export function normalizePortfolioResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const pri = isRecord(record.portfolio_risk_index)
    ? record.portfolio_risk_index
    : {};
  const decomposition = isRecord(pri.variance_decomposition)
    ? pri.variance_decomposition
    : {};
  const components: DecompositionComponent[] = LAYERS.map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    explained_risk: num(decomposition[layer]),
    hedge_ratio: null,
    hedge_etf: null,
  }));
  return {
    raw,
    normalized: {
      components,
      portfolio: pri,
      metadata: metadataFromRaw(raw),
    },
    chart_data: chartDataFromComponents(components),
    suggested_chart: "bar",
    plain_english: "The portfolio was decomposed into market, sector, subsector, and residual risk layers.",
    api_call: apiCallWithLineage(raw, apiCall),
  };
}

export function normalizeAnalyzePortfolioResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
  requestedWeights: Record<string, number>,
): RiskModelsResult<TRaw> {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const results = isRecord(record.results) ? record.results : {};

  const successful: string[] = [];
  const blocks: Record<string, HedgeLevelsBlock | undefined> = {};
  for (const [key, value] of Object.entries(results)) {
    if (!isRecord(value) || value.status === "error") continue;
    const ticker = str(value.ticker) ?? key.toUpperCase();
    successful.push(ticker);
    if (!isRecord(value.hedge_levels)) continue;
    blocks[ticker] = value.hedge_levels as unknown as HedgeLevelsBlock;
  }

  const weightsEffective = renormalizeWeights(requestedWeights, successful);
  const portfolioLevels = aggregatePortfolioHedgeLevels(weightsEffective, blocks);
  const call = apiCallWithLineage(raw, apiCall);

  return {
    raw,
    normalized: {
      tickers: successful.sort(),
      components: [],
      portfolio: {
        weights_effective: weightsEffective,
        hedge_levels_by_ticker: blocks,
        portfolio_hedge_levels: portfolioLevels,
      },
      metadata: metadataFromRaw(raw),
    },
    chart_data: [],
    suggested_chart: "table",
    plain_english:
      successful.length > 0
        ? `Holdings-weighted L1/L2/L3 hedge_levels for ${successful.length} name${successful.length === 1 ? "" : "s"}.`
        : "No hedge_levels rows returned from portfolio batch analyze.",
    api_call: call,
  };
}

export function normalizeHedgePortfolioResult<TRaw>(
  raw: TRaw,
  apiCall: ApiCallMetadata,
  dollarsByTicker: Record<string, number>,
  level: HedgeLevelId,
): RiskModelsResult<TRaw> {
  let sumD = 0;
  for (const amount of Object.values(dollarsByTicker)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    sumD += amount;
  }
  const weights: Record<string, number> =
    sumD > 0 ? Object.fromEntries(Object.entries(dollarsByTicker).map(([t, d]) => [t, d / sumD])) : {};

  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const results = isRecord(record.results) ? record.results : {};
  const blocks: Record<string, HedgeLevelsBlock | undefined> = {};
  for (const [key, value] of Object.entries(results)) {
    if (!isRecord(value) || value.status === "error") continue;
    const ticker = str(value.ticker) ?? key.toUpperCase();
    if (!isRecord(value.hedge_levels)) continue;
    blocks[ticker] = value.hedge_levels as unknown as HedgeLevelsBlock;
  }

  const portfolioLevels = aggregatePortfolioHedgeLevels(weights, blocks);
  const totals = new Map<string, number>();
  const hedgeNotionalsByTicker: Array<Record<string, unknown>> = [];

  for (const [tk, bucks] of Object.entries(dollarsByTicker)) {
    const snapshot = blocks[tk]?.[level];
    const legs = snapshot ? notionalsFromLevelSnapshot(bucks, snapshot) : [];
    hedgeNotionalsByTicker.push({ ticker: tk, dollars: bucks, hedge_legs: legs });
    for (const leg of legs) {
      totals.set(leg.etf, (totals.get(leg.etf) ?? 0) + leg.hedge_usd);
    }
  }

  const aggregateMap = Object.fromEntries([...totals]);
  const chartData: ChartDatum[] = Object.entries(aggregateMap).map(([etf, hedgeUsd]) => ({
    label: etf,
    metric: "hedge_notional",
    value: num(hedgeUsd),
    unit: "usd",
    series: level,
  }));

  const call = apiCallWithLineage(raw, apiCall);
  const tickersListed = Object.keys(weights).sort();
  const plain =
    Object.keys(aggregateMap).length === 0
      ? `No hedge_levels available to scale ${level} ETF notionals.`
      : `${level} portfolio hedge ETFs aggregated across positions (${tickersListed.join(", ")}).`;

  return {
    raw,
    normalized: {
      tickers: tickersListed,
      components: [],
      portfolio: {
        hedge_level: level,
        hedge_notionals_usd_aggregate: aggregateMap,
        hedge_notionals_by_ticker: hedgeNotionalsByTicker,
        portfolio_hedge_levels: portfolioLevels,
        hedge_levels_by_ticker: blocks,
      },
      metadata: metadataFromRaw(raw),
    },
    chart_data: chartData,
    suggested_chart: Object.keys(chartData).length ? "bar" : "table",
    plain_english: plain,
    api_call: call,
  };
}

export function assertSuggestedChart(value: string): SuggestedChart {
  if (["bar", "grouped_bar", "stacked_bar", "waterfall", "table"].includes(value)) {
    return value as SuggestedChart;
  }
  return "bar";
}
