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

/** Dollar notionals used by {@link RiskModelsClient.hedgePortfolio} (combined per ticker internally). */
export interface HedgePortfolioPosition {
  ticker: string;
  dollars: number;
}

export interface AnalyzePortfolioOptions {
  years?: number;
}

export interface HedgePortfolioOptions extends AnalyzePortfolioOptions {
  /** L1 market-only | L2 + sector | L3 full cascade; default L3 */
  level?: string;
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

export type CoveredWeightAggregation = "covered_weights_not_renormalized";

export interface PortfolioVarianceDecomposition {
  market: number | null;
  sector: number | null;
  subsector: number | null;
  residual: number | null;
  systematic: number | null;
}

export interface PortfolioRiskIndexBlock {
  variance_decomposition: PortfolioVarianceDecomposition;
  portfolio_volatility_23d: number | null;
  position_count: number;
  /** Absolute-weight share of positions with a complete four-layer ER vector. */
  er_coverage: number;
  /** Absolute-weight share with a finite volatility. */
  volatility_coverage: number;
  /** Missing names are excluded; covered weights retain their original scale. */
  aggregation: CoveredWeightAggregation;
}

export interface PortfolioRiskResponse {
  portfolio_risk_index: PortfolioRiskIndexBlock;
  data_quality_flags: string[];
  per_ticker: Record<string, Record<string, unknown>>;
  summary: {
    total_positions: number;
    resolved: number;
    errors: number;
  };
}

export interface PortfolioExposureAsOf {
  covariance_start: string | null;
  covariance_end: string | null;
  covariance_requested_n: number;
  covariance_effective_n: number | null;
  vintage_aligned: boolean;
  etf_mapping: string;
}

export interface PortfolioExposureScenarioInputs {
  covariance_start: string | null;
  covariance_end: string | null;
  covariance_effective_n: number | null;
  etfs: Array<Record<string, unknown>>;
  positions_included: boolean;
  positions?: Array<Record<string, unknown>>;
  note: string;
}

/** Null covariance counts are unavailable observations, never zero observations. */
export interface PortfolioExposureResponse {
  as_of: PortfolioExposureAsOf;
  scenario_inputs: PortfolioExposureScenarioInputs;
  data_quality_flags: string[];
  [key: string]: unknown;
}

export interface HoldingValueCoverage {
  /** Count share of holdings whose finite value contributes to the aggregate. */
  value_coverage: number;
}

export interface HoldingsAggregateQuality {
  data_quality_flags: string[];
}
