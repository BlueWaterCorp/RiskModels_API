export type RiskLayer = "market" | "sector" | "subsector" | "residual";
export type SuggestedChart = "bar" | "grouped_bar" | "stacked_bar" | "waterfall" | "table";

export interface DecompositionComponent {
  ticker?: string;
  layer: RiskLayer;
  label: string;
  explained_risk: number | null;
  hedge_ratio: number | null;
  hedge_etf: string | null;
  hedge_notional?: number | null;
}

export interface ChartDatum {
  label: string;
  ticker?: string;
  layer?: RiskLayer;
  metric: "explained_risk" | "hedge_ratio" | "hedge_notional" | "return_contribution";
  value: number | null;
  unit: "fraction" | "dollar_ratio" | "usd" | "percent";
  series?: string;
  color_hint?: "market" | "sector" | "subsector" | "residual" | "positive" | "negative";
}

export interface ApiCallMetadata {
  method: "GET" | "POST";
  path: string;
  base_url: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  curl?: string;
  data_as_of?: string;
  request_id?: string;
  cost_usd?: number;
}

export interface RiskModelsResult<TRaw = unknown> {
  raw: TRaw;
  normalized: {
    ticker?: string;
    tickers?: string[];
    components: DecompositionComponent[];
    hedge?: Record<string, number>;
    portfolio?: unknown;
    metadata?: Record<string, unknown>;
  };
  chart_data: ChartDatum[];
  suggested_chart: SuggestedChart;
  plain_english: string;
  api_call: ApiCallMetadata;
}

export type WhitepaperExampleId =
  | "aapl-vs-nvda"
  | "aapl-nvda-crwd"
  | "nvda-10000-hedge"
  | "portfolio-decomposition";

export interface WhitepaperExampleResult<TRaw = unknown> extends RiskModelsResult<TRaw> {
  example_id: WhitepaperExampleId;
  chapter_uri: string;
  chapter_title: string;
  chapter_text: string;
  prompt_to_try: string;
}

export interface PositionInput {
  ticker: string;
  weight?: number;
  dollars?: number;
}

export interface HedgePositionInput {
  ticker: string;
  dollars: number;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RiskModelsClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export type LayerExposure = Partial<Record<
  RiskLayer,
  {
    er?: number | null;
    hr?: number | null;
    hedge_etf?: string | null;
  }
>>;
