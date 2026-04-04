/**
 * Agent API Capabilities Registry
 *
 * Defines all available API capabilities for AI agents with pricing,
 * performance specs, and confidence scoring.
 */

export interface ParameterSpec {
  type: "string" | "integer" | "number" | "boolean" | "array";
  required: boolean;
  description?: string;
  default?: any;
  min?: number;
  max?: number;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, ParameterSpec>;
  };
}

export interface PricingModel {
  model: "per_request" | "per_token" | "per_position" | "subscription";
  tier: "baseline" | "premium";
  cost_usd?: number;
  currency: "USD";
  billing_code: string;
  input_cost_per_1k?: number;
  output_cost_per_1k?: number;
  min_charge?: number;
}

export interface PerformanceSpec {
  avg_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms?: number;
  availability_sla: number;
  rate_limit_per_minute?: number;
}

export interface ConfidenceSpec {
  data_quality_score: number;
  update_frequency: "real-time" | "daily" | "weekly" | "monthly" | "hourly";
  sources: string[];
  methodology_url?: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  parameters: Record<string, ParameterSpec>;
  response_schema?: string;
  pricing: PricingModel;
  performance: PerformanceSpec;
  confidence: ConfidenceSpec;
  tags?: string[];
  examples?: {
    request?: any;
    response?: any;
  }[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: "ticker-returns",
    name: "Get Ticker Returns",
    description:
      "Retrieve daily returns with L1/L2/L3 hedge ratios and risk decomposition for any stock ticker",
    endpoint: "/api/ticker-returns",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol (e.g., AAPL, NVDA, TSLA)",
      },
      years: {
        type: "integer",
        required: false,
        description: "Years of historical data to return",
        default: 1,
        min: 1,
        max: 15,
      },
      array: {
        type: "string",
        required: false,
        description: "Array name for returns data",
        default: "return",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "ticker_returns_v2",
    },
    performance: {
      avg_latency_ms: 150,
      p95_latency_ms: 250,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["market_data", "proprietary_models", "erm3_regression"],
      methodology_url: "https://riskmodels.net/docs/methodology",
    },
    tags: ["returns", "hedging", "risk-analysis"],
    examples: [
      {
        request: { ticker: "NVDA", years: 2 },
        response: {
          ticker: "NVDA",
          data: [
            { date: "2023-01-01", returns_gross: 0.012, l3_mkt_hr: 0.98, l3_sec_hr: 0.85, l3_sub_hr: 0.72 },
          ],
        },
      },
    ],
  },
  {
    id: "metrics",
    name: "Latest Risk Metrics",
    description:
      "Fetch latest hedge ratios (HR), explained risk (ER), volatility, and stock variance for a ticker from security_history (V3)",
    endpoint: "/api/metrics/{ticker}",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol (e.g., AAPL, NVDA)",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.001,
      currency: "USD",
      billing_code: "metrics_v3",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "erm3_regression"],
    },
    tags: ["metrics", "hedge-ratios", "explained-risk"],
  },
  {
    id: "rankings",
    name: "Cross-Sectional Rankings",
    description:
      "Analyzes where a security sits in its sector/universe percentile for risk and return. Per-ticker grid: GET /api/rankings/{ticker}. Leaderboard: GET /api/rankings/top?metric=&cohort=&window=&limit=. Shields badge JSON: GET /api/rankings/{ticker}/badge (public; optional RANKINGS_BADGE_TOKEN + ?token=). rank_percentile 100=best.",
    endpoint: "/api/rankings/{ticker}",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
      metric: {
        type: "string",
        required: false,
        description: "Metric: subsector_residual, sector_residual, gross_return, mkt_cap, er_l1, er_l2, er_l3",
      },
      cohort: {
        type: "string",
        required: false,
        description: "Cohort: universe, sector, subsector",
      },
      window: {
        type: "string",
        required: false,
        description: "Window: 1d, 21d, 63d, 252d",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.001,
      currency: "USD",
      billing_code: "rankings_v3",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "erm3_regression"],
    },
    tags: ["rankings", "cross-sectional", "percentile"],
  },
  {
    id: "risk-decomposition",
    name: "L3 Risk Decomposition",
    description:
      "Decompose stock risk into market, sector, and idiosyncratic components using 3-level hierarchical model",
    endpoint: "/api/l3-decomposition",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
      date: {
        type: "string",
        required: false,
        description: "Specific date for decomposition (YYYY-MM-DD format)",
        default: "latest",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "l3_decomp_v3",
    },
    performance: {
      avg_latency_ms: 120,
      p95_latency_ms: 200,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models", "factor_regression"],
      methodology_url: "https://riskmodels.net/docs/l3-methodology",
    },
    tags: ["risk-analysis", "decomposition", "factors"],
  },
  {
    id: "chat-risk-analyst",
    name: "AI Risk Analyst",
    description:
      "Natural language risk analysis with live data via OpenAI tools (non-streaming JSON). " +
      "The model can call: get_risk_metrics, get_l3_decomposition, get_ticker_returns, get_rankings, " +
      "get_factor_correlation, get_macro_factors, search_tickers (free), compute_portfolio_risk_index. " +
      "LLM usage is billed per token; each paid tool call is billed at the matching endpoint capability rate. " +
      "response_mode is reserved for future streaming.",
    endpoint: "/api/chat",
    method: "POST",
    parameters: {
      messages: {
        type: "array",
        required: true,
        description: "Conversation messages",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["user", "assistant"],
              required: true,
            },
            content: { type: "string", required: true },
          },
        },
      },
      model: {
        type: "string",
        required: false,
        description: "AI model to use",
        default: "gpt-4o-mini",
      },
      response_mode: {
        type: "string",
        required: false,
        description:
          "Reserved for future streaming / A2UI; JSON tool-use responses today",
        default: "markdown",
        enum: ["markdown", "catalog", "hybrid"],
      },
      parallel_tool_calls: {
        type: "boolean",
        required: false,
        description:
          "When false, disables OpenAI parallel_tool_calls (for models that support the flag). Default: parallel enabled for gpt-4o-mini.",
      },
      execute_tools_sequentially: {
        type: "boolean",
        required: false,
        description:
          "When true, server runs chat tools one-by-one instead of concurrently.",
      },
    },
    pricing: {
      model: "per_token",
      tier: "premium",
      input_cost_per_1k: 0.001,
      output_cost_per_1k: 0.002,
      currency: "USD",
      billing_code: "chat_risk_analyst_v2",
    },
    performance: {
      avg_latency_ms: 2000,
      p95_latency_ms: 5000,
      availability_sla: 99.5,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "real-time",
      sources: ["openai_gpt4", "riskmodels_data"],
    },
    tags: ["ai", "chat", "analysis", "natural-language", "a2ui", "streaming"],
  },
  {
    id: "plaid-link-token",
    name: "Plaid Link token (setup)",
    description:
      "Create a Plaid Link token for the authenticated user (Investments). Free setup step; session auth.",
    endpoint: "/api/plaid/link-token",
    method: "POST",
    parameters: {},
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0,
      currency: "USD",
      billing_code: "plaid_link_token_v1",
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.5,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 1,
      update_frequency: "real-time",
      sources: ["plaid"],
    },
    tags: ["plaid", "setup"],
  },
  {
    id: "plaid-exchange-public-token",
    name: "Plaid public token exchange (setup)",
    description:
      "Exchange Plaid public_token for access_token and store encrypted item for holdings sync. Free setup step; session auth.",
    endpoint: "/api/plaid/exchange-public-token",
    method: "POST",
    parameters: {},
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0,
      currency: "USD",
      billing_code: "plaid_exchange_v1",
    },
    performance: {
      avg_latency_ms: 400,
      p95_latency_ms: 1000,
      availability_sla: 99.5,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 1,
      update_frequency: "real-time",
      sources: ["plaid"],
    },
    tags: ["plaid", "setup"],
  },
  {
    id: "plaid-holdings",
    name: "Plaid investment holdings",
    description:
      "Fetch Plaid-synced investment holdings, accounts, and securities for the authenticated user",
    endpoint: "/api/plaid/holdings",
    method: "GET",
    parameters: {},
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "plaid_holdings_v2",
    },
    performance: {
      avg_latency_ms: 400,
      p95_latency_ms: 1200,
      availability_sla: 99.5,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "real-time",
      sources: ["plaid_investments"],
    },
    tags: ["plaid", "holdings", "portfolio"],
  },
  {
    id: "batch-analysis",
    name: "Portfolio Batch Analysis",
    description:
      "Analyze multiple positions for risk exposures, correlations, and hedge recommendations",
    endpoint: "/api/batch/analyze",
    method: "POST",
    parameters: {
      positions: {
        type: "array",
        required: true,
        description: "Portfolio positions to analyze",
        items: {
          type: "object",
          properties: {
            ticker: { type: "string", required: true },
            quantity: { type: "number", required: true },
            cost_basis: { type: "number", required: true },
          },
        },
      },
      analysis_type: {
        type: "string",
        required: false,
        description: "Type of analysis to perform",
        default: "comprehensive",
        enum: ["risk", "hedging", "correlation", "comprehensive"],
      },
    },
    pricing: {
      model: "per_position",
      tier: "premium",
      cost_usd: 0.005,
      currency: "USD",
      min_charge: 0.01,
      billing_code: "batch_analysis_v3",
    },
    performance: {
      avg_latency_ms: 300,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["portfolio_models", "correlation_matrices"],
    },
    tags: ["portfolio", "batch", "analysis", "hedging"],
  },
  {
    id: "ticker-search",
    name: "Ticker Search",
    description:
      "Search for tickers by symbol or company name with metadata. Searches symbols first; falls back to internal company registry for broader company-name coverage.",
    endpoint: "/api/tickers",
    method: "GET",
    parameters: {
      search: {
        type: "string",
        required: false,
        description:
          "Search query for ticker symbol or company name. Falls back to internal company registry when symbols has no match.",
      },
      mag7: {
        type: "boolean",
        required: false,
        description: "Return only Magnificent 7 tickers",
        default: false,
      },
      include_metadata: {
        type: "boolean",
        required: false,
        description:
          "Include company name, sector, and sector_etf per ticker. Enriched from internal sources when symbols lacks company_name.",
        default: false,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.001,
      currency: "USD",
      billing_code: "ticker_search_v2",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["symbols", "company_data"],
    },
    tags: ["search", "tickers", "metadata"],
  },
  {
    id: "health-status",
    name: "Health Status",
    description: "Real-time health status of all API services and capabilities",
    endpoint: "/api/health",
    method: "GET",
    parameters: {},
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.0,
      currency: "USD",
      billing_code: "health_check",
    },
    performance: {
      avg_latency_ms: 50,
      p95_latency_ms: 100,
      availability_sla: 99.99,
      rate_limit_per_minute: 300,
    },
    confidence: {
      data_quality_score: 1.0,
      update_frequency: "real-time",
      sources: ["system_monitoring"],
    },
    tags: ["health", "status", "monitoring"],
  },
  {
    id: "telemetry-metrics",
    name: "Telemetry Metrics",
    description:
      "Detailed performance and reliability metrics for API capabilities",
    endpoint: "/api/telemetry",
    method: "GET",
    parameters: {
      capability: {
        type: "string",
        required: false,
        description: "Specific capability to get metrics for",
      },
      days: {
        type: "integer",
        required: false,
        description: "Number of days of historical data",
        default: 30,
        min: 1,
        max: 90,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.002,
      currency: "USD",
      billing_code: "telemetry_v2",
    },
    performance: {
      avg_latency_ms: 100,
      p95_latency_ms: 200,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "hourly",
      sources: ["telemetry_system", "performance_metrics"],
    },
    tags: ["telemetry", "metrics", "performance"],
  },
  {
    id: "metrics-snapshot",
    name: "Metrics Snapshot",
    description: "Latest risk metrics snapshot for a single ticker (volatility, hedge ratios, explained risk)",
    endpoint: "/api/metrics",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.001,
      currency: "USD",
      billing_code: "metrics_snapshot_v1",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "symbols"],
    },
    tags: ["metrics", "snapshot", "risk"],
  },
  {
    id: "l3-decomposition",
    name: "L3 Decomposition",
    description: "Decompose stock risk into market, sector, and idiosyncratic components",
    endpoint: "/api/l3-decomposition",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
      market_factor_etf: {
        type: "string",
        required: false,
        description: "Market factor ETF",
        default: "SPY",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "l3_decomposition_v2",
    },
    performance: {
      avg_latency_ms: 120,
      p95_latency_ms: 200,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models", "security_history"],
    },
    tags: ["risk", "decomposition", "l3"],
  },
  {
    id: "portfolio-returns",
    name: "Portfolio Returns",
    description: "Batch fetch returns for multiple tickers (portfolio analytics)",
    endpoint: "/api/portfolio/returns",
    method: "POST",
    parameters: {
      tickers: {
        type: "array",
        required: true,
        description: "Array of ticker symbols",
        items: { type: "string" },
      },
      years: {
        type: "integer",
        required: false,
        description: "Years of history",
        default: 3,
      },
    },
    pricing: {
      model: "per_position",
      tier: "premium",
      cost_usd: 0.004,
      currency: "USD",
      min_charge: 0.01,
      billing_code: "portfolio_returns_v2",
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 400,
      availability_sla: 99.9,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history"],
    },
    tags: ["portfolio", "returns", "batch"],
  },
  {
    id: "portfolio-risk-index",
    name: "Portfolio Risk Index",
    description: "Compute Portfolio Risk Index (variance decomposition)",
    endpoint: "/api/portfolio/risk-index",
    method: "POST",
    parameters: {
      positions: {
        type: "array",
        required: true,
        description: "Array of { ticker, weight }",
        items: {
          type: "object",
          properties: {
            ticker: { type: "string", required: true },
            weight: { type: "number", required: true },
          },
        },
      },
      timeSeries: {
        type: "boolean",
        required: false,
        description: "Return PRI time series",
        default: false,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.03,
      currency: "USD",
      billing_code: "portfolio_risk_index_v2",
    },
    performance: {
      avg_latency_ms: 300,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "symbols"],
    },
    tags: ["portfolio", "risk", "pri"],
  },
  {
    id: "portfolio-risk-snapshot",
    name: "Portfolio risk snapshot",
    description:
      "One-page portfolio risk report as PDF or structured JSON: L3 explained-risk decomposition, hedge ratios, and per-position breakdown. Single bundled charge; uses internal data access only (no double-billing).",
    endpoint: "/api/portfolio/risk-snapshot",
    method: "POST",
    parameters: {
      positions: {
        type: "array",
        required: true,
        description: "Portfolio positions { ticker, weight }",
        items: {
          type: "object",
          properties: {
            ticker: { type: "string", required: true },
            weight: { type: "number", required: true },
          },
        },
      },
      title: {
        type: "string",
        required: false,
        description: "Optional report title",
      },
      as_of_date: {
        type: "string",
        required: false,
        description: "Optional display date YYYY-MM-DD (data still latest available)",
      },
      format: {
        type: "string",
        required: false,
        description: "pdf | json (png planned)",
        enum: ["pdf", "json", "png"],
        default: "json",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.25,
      currency: "USD",
      billing_code: "risk_snapshot_pdf_v1",
    },
    performance: {
      avg_latency_ms: 800,
      p95_latency_ms: 2500,
      availability_sla: 99.5,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "symbols"],
    },
    tags: ["portfolio", "pdf", "risk", "report"],
  },
  {
    id: "factor-correlation",
    name: "Macro factor correlation",
    description:
      "Measures exposure to macro-economic drivers like interest rates and volatility. Pearson or Spearman correlation between a stock return series (gross or ERM3 L1/L2/L3 residual) and daily macro factor returns from macro_factors. POST /api/correlation or GET /api/metrics/{ticker}/correlation. JSON Schema POST body: factor-correlation-request-v1.json; single-ticker success: factor-correlation-v1.json (MCP schema list).",
    endpoint: "/api/correlation",
    method: "POST",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker, or array of tickers for batch",
      },
      factors: {
        type: "array",
        required: false,
        description: "Macro factor keys (bitcoin, gold, oil, dxy, vix, ust10y2y); default all six",
      },
      return_type: {
        type: "string",
        required: false,
        description: "gross | l1 | l2 | l3_residual",
        default: "l3_residual",
        enum: ["gross", "l1", "l2", "l3_residual"],
      },
      window_days: {
        type: "integer",
        required: false,
        description: "Trailing paired observations for correlation",
        default: 252,
        min: 20,
        max: 2000,
      },
      method: {
        type: "string",
        required: false,
        description: "pearson | spearman",
        default: "pearson",
        enum: ["pearson", "spearman"],
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.002,
      currency: "USD",
      billing_code: "factor_correlation_v1",
    },
    performance: {
      avg_latency_ms: 120,
      p95_latency_ms: 250,
      availability_sla: 99.5,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "daily",
      sources: ["security_history", "macro_factors"],
    },
    tags: ["correlation", "macro", "factors"],
  },
  {
    id: "macro-factor-series",
    name: "Macro factor time series",
    description:
      "Read-only daily macro factor total returns from Supabase `macro_factors` (no stock ticker). GET /api/macro-factors with optional `factors`, `start`, `end` (YYYY-MM-DD). JSON Schema for 200 body: macro-factors-series-v1.json (MCP schema list).",
    endpoint: "/api/macro-factors",
    method: "GET",
    parameters: {
      factors: {
        type: "string",
        required: false,
        description:
          "Comma-separated factor keys (bitcoin, gold, oil, dxy, vix, ust10y2y); aliases e.g. btc → bitcoin. Default all six.",
      },
      start: {
        type: "string",
        required: false,
        description: "Inclusive start date (YYYY-MM-DD). Default: five calendar years before `end`.",
      },
      end: {
        type: "string",
        required: false,
        description: "Inclusive end date (YYYY-MM-DD). Default: today (UTC).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.001,
      currency: "USD",
      billing_code: "macro_factor_series_v1",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 200,
      availability_sla: 99.5,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "daily",
      sources: ["macro_factors"],
    },
    tags: ["macro", "factors", "time-series"],
  },
  {
    id: "cli-query",
    name: "CLI SQL Query",
    description:
      "Execute SQL SELECT queries against risk model data via CLI or programmatic access",
    endpoint: "/api/cli/query",
    method: "POST",
    parameters: {
      sql: {
        type: "string",
        required: true,
        description: "SQL SELECT query to execute",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Maximum rows to return",
        default: 100,
        min: 1,
        max: 10000,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.003,
      currency: "USD",
      billing_code: "cli_query_v1",
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["supabase_db", "exec_sql_rpc"],
    },
    tags: ["cli", "sql", "query", "data-access"],
    examples: [
      {
        request: {
          sql: "SELECT ticker, latest_er_total FROM symbols LIMIT 5",
        },
        response: {
          results: [
            { ticker: "AAPL", l3_res_er: 0.54 },
            { ticker: "NVDA", l3_res_er: 0.38 },
          ],
          count: 2,
          cost_usd: 0.003,
        },
      },
    ],
  },
];

export async function getCapabilities(): Promise<Capability[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://riskmodels.net";

  return CAPABILITIES.map((capability) => ({
    ...capability,
    endpoint: `${baseUrl}${capability.endpoint}`,
  }));
}

export function getCapabilityById(id: string): Capability | undefined {
  return CAPABILITIES.find((cap) => cap.id === id);
}

export function getCapabilityPricing(id: string): PricingModel {
  const capability = getCapabilityById(id);
  if (!capability) {
    throw new Error(`Capability ${id} not found`);
  }
  return capability.pricing;
}

export function calculateRequestCost(
  capabilityId: string,
  inputTokens?: number,
  outputTokens?: number,
  itemCount?: number,
): number {
  const pricing = getCapabilityPricing(capabilityId);

  switch (pricing.model) {
    case "per_request":
      return pricing.cost_usd || 0;

    case "per_token":
      const inputCost =
        ((inputTokens || 0) * (pricing.input_cost_per_1k || 0)) / 1000;
      const outputCost =
        ((outputTokens || 0) * (pricing.output_cost_per_1k || 0)) / 1000;
      return inputCost + outputCost;

    case "per_position":
      const baseCost = pricing.cost_usd || 0;
      const itemCost = (itemCount || 1) * baseCost;
      return Math.max(itemCost, pricing.min_charge || 0);

    case "subscription":
      return 0; // Subscription-based capabilities are free per-request

    default:
      return 0;
  }
}

export function validateCapabilityAccess(
  capabilityId: string,
  userScopes?: string[],
): boolean {
  const capability = getCapabilityById(capabilityId);
  if (!capability) {
    return false;
  }

  // If no scopes are provided, assume full access (for backward compatibility)
  if (!userScopes || userScopes.length === 0) {
    return true;
  }

  // Check if user has required scopes
  return userScopes.includes(capabilityId) || userScopes.includes("*");
}

/**
 * Get capability information (for backward compatibility)
 */
export function getCapability(id: string): Capability | undefined {
  return getCapabilityById(id);
}

/**
 * Calculate estimated cost (for backward compatibility)
 */
export function calculateEstimatedCost(
  capabilityId: string,
  options?: {
    itemCount?: number;
    inputTokens?: number;
    outputTokens?: number;
  },
): number {
  return calculateRequestCost(
    capabilityId,
    options?.inputTokens,
    options?.outputTokens,
    options?.itemCount,
  );
}
