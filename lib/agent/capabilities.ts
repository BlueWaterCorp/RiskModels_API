/**
 * Agent API Capabilities Registry
 *
 * Defines all available API capabilities for AI agents with pricing,
 * performance specs, and confidence scoring.
 */

/**
 * Per-slug render-param applicability for the artifact-render capability.
 *
 * Spelled out from the same map render-svc enforces (`_SLUG_PARAMS`, mirrored
 * as `ARTIFACT_SLUG_PARAMS`) so the registry cannot advertise a param the
 * server refuses, or omit one it accepts. Built here rather than imported to
 * keep this module free of runtime dependencies — `scripts/generate-mcp-capabilities.mjs`
 * bundles and evaluates it, and pulling in the render client would drag GCP
 * auth into that build. The parity test is what makes the copy safe.
 */
const ARTIFACT_RENDER_PARAM_APPLICABILITY: Record<string, string[]> = {
  top_holdings_erm_stacked: ["top_n"],
  cumulative_return_strip: ["window"],
  position_cumulative_decomposition: ["window"],
  l3_explained_risk_hbar: ["layers"],
  active_risk_composition: ["layers"],
  hedge_notionals_hbar: ["top_n"],
  watchlist_er_stacked: ["sort_by", "top_n"],
  risk_dna_stacked: ["peer_n", "sort_by"],
  historical_risk_waterfall: ["date", "window"],
  holdings_active_panel: ["benchmark", "top_n"],
};

export const ARTIFACT_RENDER_PARAMS_DESCRIPTION =
  "Per-slug render params. Accepted keys: top_n (int 1-50), peer_n (int 1-50), " +
  "window ('3m'|'6m'|'1y'|'2y'|'3y'|'5y'|'max'), sort_by (string), layers " +
  "(comma-separated lowercase cascade levels), date (YYYY-MM-DD), benchmark " +
  "(bw_bench_id | alias | ff_own | cell_<slug>). Applicability — " +
  Object.entries(ARTIFACT_RENDER_PARAM_APPLICABILITY)
    .map(([slug, keys]) => `${slug}: ${keys.join("+")}`)
    .sort()
    .join("; ") +
  ". Every other slug accepts none. Unknown or slug-inapplicable params → 422; " +
  "a value the artifact module does not accept also → 422 (window ladders differ " +
  "per slug). `date` selects an observation inside a history panel and is NOT the " +
  "request-level `as_of`, which selects the artifact vintage. Params participate " +
  "in the render-once GCS cache key ({as_of}.top_n-5.json); empty params keep the " +
  "legacy key. GET /api/artifacts/capability serves this map alongside the " +
  "verified (slug, subject_kind) pairs.";

export interface ParameterSpec {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
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

export const PRICE_BOOK = {
  version: "2026-08-14",
  /** New keys are billed on this schedule from this date. */
  effective: "2026-08-14",
  /** Existing billed accounts keep legacy_* rates through this date (inclusive, UTC). */
  grandfather_until: "2026-12-31",
} as const;

export interface PricingModel {
  model: "per_request" | "per_token" | "per_position" | "subscription";
  tier: "baseline" | "premium";
  cost_usd?: number;
  /** Added to cost_usd for each year above 1 (years clamped 1–15). R3. */
  cost_per_extra_year_usd?: number;
  currency: "USD";
  billing_code: string;
  input_cost_per_1k?: number;
  output_cost_per_1k?: number;
  min_charge?: number;
  /** Prior schedule; used through PRICE_BOOK.grandfather_until for pre-cutover accounts. */
  legacy_cost_usd?: number;
  legacy_min_charge?: number;
  legacy_input_cost_per_1k?: number;
  legacy_output_cost_per_1k?: number;
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
  update_frequency: "real-time" | "daily" | "weekly" | "monthly" | "hourly" | "quarterly";
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
      "Retrieve daily returns with L1/L2/L3 hedge ratios and risk decomposition for any stock ticker. " +
      "Priced at $0.02 for 1 year plus $0.01 per additional year (years 1–15).",
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
      cost_usd: 0.02,
      cost_per_extra_year_usd: 0.01,
      currency: "USD",
      billing_code: "ticker_returns_v3",
      legacy_cost_usd: 0.005,
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
      methodology_url: "https://riskmodels.app/docs/methodology",
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
      "Full V3 risk snapshot for a ticker: L1/L2/L3 hedge ratios (HR) and explained risk (ER), " +
      "vol_23d (23d annualized realized vol), stock_var (252d rolling variance), price_close, and market_cap. " +
      "Returns V3 metric fields from security_history_latest (including returns-decomposition keys l*_cfr / l*_rr when present) with EAV fallback.",
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
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "metrics_v4",
      legacy_cost_usd: 0.001,
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
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "rankings_v4",
      legacy_cost_usd: 0.001,
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
      cost_usd: 0.04,
      currency: "USD",
      billing_code: "l3_decomp_v4",
      legacy_cost_usd: 0.02,
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
      methodology_url: "https://riskmodels.app/docs/methodology",
    },
    tags: ["risk-analysis", "decomposition", "factors"],
  },
  {
    id: "chat-risk-analyst",
    name: "AI Risk Analyst",
    description:
      "Natural language risk analysis with live data via OpenAI tools (non-streaming JSON). " +
      "The model can call: get_stock_commentary_bundle (one-pull single-name evidence), compare_tickers (2–8 names, one bill), get_risk_metrics, get_l3_decomposition, get_ticker_returns, get_rankings, " +
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
        default: "kimi-k2.5",
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
      input_cost_per_1k: 0.005,
      output_cost_per_1k: 0.01,
      currency: "USD",
      billing_code: "chat_risk_analyst_v3",
      legacy_input_cost_per_1k: 0.001,
      legacy_output_cost_per_1k: 0.002,
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
      cost_usd: 0.1,
      currency: "USD",
      billing_code: "plaid_holdings_v3",
      legacy_cost_usd: 0.02,
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
      cost_usd: 0.015,
      currency: "USD",
      min_charge: 0.03,
      billing_code: "batch_analysis_v4",
      legacy_cost_usd: 0.005,
      legacy_min_charge: 0.01,
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
    id: "peers",
    name: "Peer Cohort",
    description:
      "Return a market-cap-ordered sector/subsector peer cohort for a ticker (GET /api/peers). Prefers subsector_etf grouping with sector_etf fallback. Used by PeerGroupProxy and selection-skill workflows.",
    endpoint: "/api/peers",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Target stock ticker (case-insensitive)",
      },
      group_by: {
        type: "string",
        required: false,
        description: "Peer grouping field: subsector_etf (default) or sector_etf",
        default: "subsector_etf",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max peers returned (default 50, max 200)",
        default: 50,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "peers_v2",
      legacy_cost_usd: 0.001,
    },
    performance: {
      // Measured 2026-08-01: 12 live fetchPeersByTicker calls against prod
      // Supabase (cohort fetch + batch market-cap summary), avg 364ms,
      // p95 888ms. Remeasure at the route once /api/peers is deployed.
      avg_latency_ms: 364,
      p95_latency_ms: 888,
      availability_sla: 99.5,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.97,
      update_frequency: "daily",
      sources: ["symbols", "security_history_latest"],
    },
    tags: ["peers", "sector", "subsector", "cohort"],
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
      cost_usd: 0,
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
      cost_usd: 0.01,
      currency: "USD",
      billing_code: "telemetry_v3",
      legacy_cost_usd: 0.002,
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
    id: "decompose-position",
    name: "Decompose Position",
    description:
      "Decompose a stock into market, sector, subsector, and residual exposure with hedge ratios mapped to tradable ETFs.",
    endpoint: "/api/decompose",
    method: "POST",
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
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "metrics_v4",
      legacy_cost_usd: 0.001,
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
      sources: ["security_history", "symbols", "ticker_metadata"],
    },
    tags: ["decompose", "hedge", "exposure", "agent"],
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
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "metrics_snapshot_v2",
      legacy_cost_usd: 0.001,
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
    id: "fundamentals",
    name: "Quarterly Fundamentals",
    description:
      "Point-in-time quarterly fundamentals for a single ticker: TTM profitability ratios (ROE, ROA, FCF margin), capital-return ratios (payout, retention, buyback, total payout, sustainable growth), leverage, ERM3 cascade betas with provenance, the cost-of-capital layer (cost of equity, cost of debt, book-weight WACC, economic profit), and an equity-bridge decomposition. sec_facts carries raw line items per cell where the serving value is SEC XBRL (revenue, net income, equity, cash flows, dividends, buybacks, etc.); vendor-sourced cells are not exposed as raw. Rows are visible iff filed_date <= as_of (never 'latest'). Realized historical data only — no forecasts, no analyst fields. Coverage starts ~2009 for most filers. Per-symbol per-call only; no batch variant.",
    endpoint: "/api/fundamentals",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
      as_of: {
        type: "string",
        required: false,
        description:
          "PIT date (YYYY-MM-DD). Rows are visible iff filed_date <= as_of. Default: today.",
      },
      periods: {
        type: "integer",
        required: false,
        description: "Quarterly rows returned (most recent last).",
        default: 8,
        min: 1,
        max: 40,
      },
      erp: {
        type: "number",
        required: false,
        description:
          "Equity risk premium for the cost-of-capital layer. Always caller-supplied; no ERP opinion is stored.",
        default: 0.05,
      },
      tax_rate: {
        type: "number",
        required: false,
        description: "Tax rate applied to the WACC debt shield.",
        default: 0.21,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fundamentals_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 250,
      p95_latency_ms: 900,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: ["fundamentals_panel_v1"],
    },
    tags: ["fundamentals", "cost-of-capital", "pit", "derived"],
  },
  {
    id: "hedge-basket",
    name: "Hedge Basket",
    description: "Structured 4-leg hedge basket (stock + SPY + sector ETF + subsector ETF) with per-leg β-to-SPY contribution, net market β subtotal, marginal ERs, recommended_hedge_level, and a human-readable decision_trace narration. Replaces the easy-to-misread single 'Market HR (L3)' row in chat/SDK surfaces.",
    endpoint: "/api/hedge-basket",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: true,
        description: "Stock ticker symbol",
      },
      user_segment: {
        type: "string",
        required: false,
        description: "Drives leverage cap: retail (1.5×) | family_office (2.0× default) | ls_equity (3.0×) | stat_arb (5.0×)",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "hedge_basket_v2",
      legacy_cost_usd: 0.001,
    },
    performance: {
      avg_latency_ms: 110,
      p95_latency_ms: 220,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["security_history", "symbols", "ds_erm3_link_betas"],
    },
    tags: ["hedge", "basket", "recommendation", "decompose"],
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
      cost_usd: 0.04,
      currency: "USD",
      billing_code: "l3_decomposition_v3",
      legacy_cost_usd: 0.02,
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
    id: "returns-decomposition",
    name: "Returns Decomposition",
    description:
      "Daily gross return plus L1/L2/L3 factor, combined-factor, and residual return series from ds_erm3_returns. Optional include_lstar adds Lstar level and Lstar-dispatched residual return per date.",
    endpoint: "/api/returns-decomposition",
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
      years: {
        type: "integer",
        required: false,
        description: "Calendar years of daily history",
        default: 1,
      },
      include_lstar: {
        type: "boolean",
        required: false,
        description: "Include lstar and lstar_residual_return arrays",
        default: false,
      },
      threshold: {
        type: "number",
        required: false,
        description: "Marginal ER threshold when deriving Lstar (default 1%)",
        default: 0.01,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.04,
      cost_per_extra_year_usd: 0.01,
      currency: "USD",
      billing_code: "returns_decomposition_v2",
      legacy_cost_usd: 0.02,
    },
    performance: {
      avg_latency_ms: 140,
      p95_latency_ms: 240,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["ds_erm3_returns", "security_history"],
    },
    tags: ["returns", "decomposition", "lstar", "macro"],
  },
  {
    id: "industry-panel",
    name: "Industry Panel",
    description:
      "Cross-section of Vasicek industry peer β statistics from ds_erm3_industry: beta_mean, beta_variance, n_companies, and total_log_mcap_weight by EODHD industry code and cascade level (market/sector/subsector). Default by=level is one row per (industry, level). by=fact is one row per (industry, fact). Multi-fact cells are historical (last L3 day 2021-06-22); latest teo is n_facts=1. by=fact is 409 only on a leftover level-keyed vintage.",
    endpoint: "/api/industry-panel",
    method: "GET",
    parameters: {
      market_factor_etf: {
        type: "string",
        required: false,
        description: "Market factor ETF",
        default: "SPY",
      },
      teo: {
        type: "string",
        required: false,
        description: "Observation date YYYY-MM-DD (default latest teo)",
      },
      level: {
        type: "string",
        required: false,
        description: "Optional cascade level filter",
        enum: ["market", "sector", "subsector"],
      },
      min_peers: {
        type: "integer",
        required: false,
        description: "Minimum n_companies (default from zarr min_peers attr). Applied per fact before any by=level collapse.",
      },
      by: {
        type: "string",
        required: false,
        description: "Grouping: level (default, one row per industry×level) or fact (one row per industry×fact; 409 only on a leftover level-keyed vintage).",
        enum: ["level", "fact"],
        default: "level",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.04,
      currency: "USD",
      billing_code: "industry_panel_v2",
      legacy_cost_usd: 0.02,
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
      sources: ["ds_erm3_industry"],
    },
    tags: ["industry", "macro", "cross-section", "stat-arb"],
  },
  {
    id: "cohorts",
    name: "Cohort Statistics (cross-section)",
    description:
      "Cohort surfaces billed under this capability: cross-section/series/roster " +
      "from ds_erm3_cohorts; peer variance-shares; residual-leadership ranks; and " +
      "GET /api/stocks/{ticker}/commentary-bundle (one-pull metrics + return record " +
      "+ standing + peer shares + residual rank for stock commentary). " +
      "One-teo cross-section of cross-sectional residual statistics by cohort (market + GICS sector) from ds_erm3_cohorts: residual_mean, residual_sd, residual_skew, residual_p10/p90, mean_pairwise_corr, n_names, n_effective, weight_top1, membership_churn, linked_beta (+link_fit_resid_sd/r2/roll63), cohort_factor_return, cohort_residual_return, cohort_ER, factor_source. link_fit_resid_sd is the residual standard deviation of the 252-day link regression (cohort factor on its parent) — a fit-quality / dispersion measure, NOT a standard error of linked_beta and not a total-uncertainty measure; do not build confidence intervals from it. The former name linked_beta_se was removed on 2026-08-25. ERM3 residuals are fitted WITHOUT an intercept and so retain each stock's alpha — the cross-sectional mean is NOT zero, and residual_mean is the quantity you subtract to demean a relative-ranking signal. Public scope is SPY + the 11 GICS sector SPDRs; the subsector cohort slate is proprietary and not addressable. Filter thin cohorts with min_names.",
    endpoint: "/api/cohorts",
    method: "GET",
    parameters: {
      cohorts: {
        type: "string",
        required: false,
        description:
          "Comma-separated cohort tickers (SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE). Default: all public cohorts.",
      },
      variables: {
        type: "string",
        required: false,
        description:
          "Comma-separated variable names. Default: residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective.",
      },
      teo: {
        type: "string",
        required: false,
        description: "Observation date YYYY-MM-DD (default latest teo)",
      },
      min_names: {
        type: "integer",
        required: false,
        description:
          "Drop cohorts with fewer than this many members — their residual statistics are noise. Default 0.",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.04,
      currency: "USD",
      billing_code: "cohorts_v2",
      legacy_cost_usd: 0.02,
    },
    performance: {
      avg_latency_ms: 150,
      p95_latency_ms: 260,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["ds_erm3_cohorts"],
    },
    tags: ["cohort", "residual", "dispersion", "cross-section", "demean"],
  },
  {
    id: "cohorts-series",
    name: "Cohort Statistics (time series)",
    description:
      "Cohort residual statistics over a date range, one series per cohort. This is the demeaning endpoint: request residual_mean at the level your residual is defined against (sector residuals demean within sector cohorts) and subtract it. Panel runs 2000-01-03 to present, though full factor richness begins around 2006. Each cohort reports proxied_fraction — the share of returned days whose factor came from a substitute instrument — because two sector cohorts are majority-proxied over long windows and a chart that hides that shows partly a different basket. Public scope is SPY + the 11 GICS sector SPDRs. link_fit_resid_sd is the residual standard deviation of the 252-day link regression (cohort factor on its parent) — a fit-quality / dispersion measure, NOT a standard error of linked_beta and not a total-uncertainty measure; do not build confidence intervals from it. The former name linked_beta_se was removed on 2026-08-25.",
    endpoint: "/api/cohorts/series",
    method: "GET",
    parameters: {
      cohorts: {
        type: "string",
        required: false,
        description:
          "Comma-separated cohort tickers. Default: all public cohorts.",
      },
      variables: {
        type: "string",
        required: false,
        description:
          "Comma-separated variable names. Default: residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective.",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Window start YYYY-MM-DD (default panel start)",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Window end YYYY-MM-DD (default latest teo)",
      },
      min_names: {
        type: "integer",
        required: false,
        description:
          "Drop days where the cohort had fewer than this many members. Default 0.",
      },
      include_proxy_source: {
        type: "string",
        required: false,
        description:
          "Set 'true' to include the per-day instrument backing the cohort factor.",
        enum: ["true", "false"],
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.15,
      currency: "USD",
      billing_code: "cohorts_series_v2",
      legacy_cost_usd: 0.03,
    },
    performance: {
      avg_latency_ms: 260,
      p95_latency_ms: 600,
      availability_sla: 99.9,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["ds_erm3_cohorts"],
    },
    tags: ["cohort", "residual", "dispersion", "time-series", "demean"],
  },
  {
    id: "cohorts-roster",
    name: "Cohort Roster (discovery)",
    description:
      "The addressable cohorts, their parent links, the variable catalogue, and the interpretation notes that govern correct use — including the no-intercept contract read directly from the store. Free discovery step; call this before /api/cohorts to learn what may be requested and what the numbers mean. link_fit_resid_sd is the residual standard deviation of the 252-day link regression (cohort factor on its parent) — a fit-quality / dispersion measure, NOT a standard error of linked_beta and not a total-uncertainty measure; do not build confidence intervals from it. The former name linked_beta_se was removed on 2026-08-25.",
    endpoint: "/api/cohorts/roster",
    method: "GET",
    parameters: {},
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0,
      currency: "USD",
      billing_code: "cohorts_roster_v1",
    },
    performance: {
      avg_latency_ms: 90,
      p95_latency_ms: 180,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["ds_erm3_cohorts"],
    },
    tags: ["cohort", "discovery", "metadata"],
  },
  {
    id: "cohorts-pnl-decomposition",
    name: "Selection vs Drift Decomposition",
    description:
      "Splits a book's realized residual return into within-cohort SELECTION (what it earned by holding names that beat their cohort's average residual) and DRIFT (what it earned purely from net exposure to that average, which accrues on net weight regardless of any selection skill). The two sum to the total exactly — an identity, not a fitted attribution. Answers 'was I paid for stock-picking, or for being net long the average stock?', which is answerable only because ERM3 fits residuals without an intercept and the cohort store exposes the resulting non-zero cross-sectional mean. level='sector' demeans each name's sector-level residual against its sector cohort; level='market' demeans market-level residuals against the market cohort. Weights are treated as constant over the window and are not normalized — rescaling them would change the drift term. Realized historical attribution only; not a forecast, backtest, or recommendation.",
    endpoint: "/api/cohorts/pnl-decomposition",
    method: "POST",
    parameters: {
      positions: {
        type: "array",
        required: true,
        description:
          "Positions as [{ticker, weight}]. Weight may be negative for a short. Max 500.",
        items: { type: "object" },
      },
      level: {
        type: "string",
        required: false,
        description:
          "Cascade level. 'sector' (default) uses each name's sector-level residual; 'market' uses market-level.",
        enum: ["market", "sector"],
        default: "sector",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Window start YYYY-MM-DD.",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Window end YYYY-MM-DD.",
      },
      min_names: {
        type: "integer",
        required: false,
        description:
          "Ignore cohort means on days the cohort had fewer than this many members.",
      },
      include_series: {
        type: "boolean",
        required: false,
        description: "Include the daily selection/drift series (bulky). Default false.",
        default: false,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.25,
      currency: "USD",
      billing_code: "cohorts_pnl_decomposition_v2",
      legacy_cost_usd: 0.05,
    },
    performance: {
      avg_latency_ms: 600,
      p95_latency_ms: 1600,
      availability_sla: 99.9,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["ds_erm3_cohorts", "ds_erm3_returns"],
    },
    tags: ["cohort", "attribution", "portfolio", "selection", "drift"],
  },
  {
    id: "rankings-screen",
    name: "Rankings Screen",
    description:
      "Full cross-section rank screen from ds_rankings zarr: server-side percentile, decile, and sector ETF filters over the entire universe at one teo (default latest). Returns up to 500 names sorted by rank_ordinal (1 = best). rank_percentile 100 = best.",
    endpoint: "/api/rankings/screen",
    method: "POST",
    parameters: {
      metric: {
        type: "string",
        required: true,
        description:
          "Metric: mkt_cap, gross_return, sector_residual, subsector_residual, er_l1, er_l2, er_l3",
      },
      cohort: {
        type: "string",
        required: true,
        description: "Cohort: universe, sector, subsector",
      },
      window: {
        type: "string",
        required: true,
        description: "Window: 1d, 21d, 63d, 252d",
      },
      as_of: {
        type: "string",
        required: false,
        description: "Observation date YYYY-MM-DD (default latest teo)",
      },
      min_percentile: {
        type: "number",
        required: false,
        description: "Minimum rank_percentile inclusive (100 = best)",
      },
      decile: {
        type: "integer",
        required: false,
        description: "Decile bucket 1=best (top 10%), through 10",
      },
      sector_filter: {
        type: "string",
        required: false,
        description: "Sector ETF ticker filter (e.g. XLK) on symbols.sector_etf",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max rows after filter (1–500, default 100)",
        default: 100,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.25,
      currency: "USD",
      billing_code: "rankings_screen_v2",
      legacy_cost_usd: 0.05,
    },
    performance: {
      avg_latency_ms: 180,
      p95_latency_ms: 350,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["ds_rankings"],
    },
    tags: ["rankings", "cross-sectional", "screen", "percentile"],
  },
  {
    id: "lstar",
    name: "Lstar Recommended Hedge Level",
    description:
      "Per-(ticker, date) recommended hedge level (L1/L2/L3) with the chosen level's dispatched hedge ratios and daily residual return at that level (`residual_return[]`, aligned with `dates`). Selection rule picks the simplest level whose marginal explained-return clears the threshold (default 1%); routes mega-caps with noisy subsector hedges down to L2.",
    endpoint: "/api/lstar",
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
      years: {
        type: "integer",
        required: false,
        description: "Calendar years of daily history",
        default: 1,
      },
      threshold: {
        type: "number",
        required: false,
        description:
          "Marginal-ER threshold for level selection. Chat / agentic surfaces should leave at the 1% default; SDK callers may override.",
        default: 0.01,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      cost_per_extra_year_usd: 0.01,
      currency: "USD",
      billing_code: "lstar_v2",
      legacy_cost_usd: 0.02,
    },
    performance: {
      avg_latency_ms: 130,
      p95_latency_ms: 220,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models", "security_history"],
    },
    tags: ["risk", "decomposition", "lstar", "hedge"],
  },
  {
    id: "batch-lstar",
    name: "Batch Lstar Residual Returns",
    description:
      "Up to 100 tickers: per-date Lstar level (L1/L2/L3) with dispatched hedge ratios and Lstar-dispatched daily residual return. Same selection rule as GET /lstar; 25% cheaper per ticker than repeated single-ticker calls.",
    endpoint: "/api/batch/lstar",
    method: "POST",
    parameters: {
      tickers: {
        type: "array",
        required: true,
        description: "Stock ticker symbols (max 100)",
        items: { type: "string" },
      },
      market_factor_etf: {
        type: "string",
        required: false,
        description: "Market factor ETF",
        default: "SPY",
      },
      years: {
        type: "integer",
        required: false,
        description: "Calendar years of daily history",
        default: 1,
      },
      threshold: {
        type: "number",
        required: false,
        description: "Marginal-ER threshold for Lstar selection (default 1%)",
        default: 0.01,
      },
      format: {
        type: "string",
        required: false,
        description: "json (default), parquet, or csv long table",
        default: "json",
        enum: ["json", "parquet", "csv"],
      },
    },
    pricing: {
      model: "per_position",
      tier: "premium",
      cost_usd: 0.015,
      cost_per_extra_year_usd: 0.0075,
      currency: "USD",
      min_charge: 0.03,
      billing_code: "batch_lstar_v2",
      legacy_cost_usd: 0.005,
      legacy_min_charge: 0.01,
    },
    performance: {
      avg_latency_ms: 350,
      p95_latency_ms: 800,
      availability_sla: 99.9,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models", "security_history"],
    },
    tags: ["risk", "decomposition", "lstar", "batch", "macro", "stat-arb"],
  },
  {
    id: "residual-signal",
    name: "Residual Mean-Reversion Signal",
    description:
      "L3 orthogonal-residual 5-day mean-reversion factor. A combo-input building block for multi-signal alpha stacks — NOT a standalone strategy. Returns residual_z_5d, decile_rank, signal_quality_quintile (subsector-tracking conditioning), industry_percentile and a residual autocorrelation diagnostic. Every response carries an explicit gross-Sharpe + market-impact capacity disclosure.",
    endpoint: "/api/residual-signal",
    method: "GET",
    parameters: {
      ticker: {
        type: "string",
        required: false,
        description:
          "Stock ticker for the per-ticker snapshot + history route (/api/residual-signal/{ticker}). Omit for the /latest and /decile routes.",
      },
      days: {
        type: "integer",
        required: false,
        description: "Calendar-day lookback for the per-ticker history window.",
        default: 90,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "residual_signal_v2",
      legacy_cost_usd: 0.02,
    },
    performance: {
      avg_latency_ms: 140,
      p95_latency_ms: 240,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models"],
    },
    tags: ["risk", "signal", "mean-reversion", "stat-arb", "factor"],
  },
  {
    id: "residual-signal-basket",
    name: "Residual Mean-Reversion Basket",
    description:
      "Aggregate the L3 residual mean-reversion signal across a user-defined basket of tickers (max 500). Returns the weighted aggregate of residual_z_5d / signal_strength / l3_subsector_er + decile and quality-quintile histograms + per-member rows. Equal-weight default; optional `weights[]` aligned to tickers; optional `signal_quality_min_quintile` gate (Phase B: gross Sharpe lifts from ~0.79 to ~1.28 at quintile 5). Tickers absent from ds_erm3_residual_signal are silently dropped — see `coverage.missing_tickers`. Combo-input building block, NOT a standalone strategy.",
    endpoint: "/api/signals/residual-reversion/basket",
    method: "POST",
    parameters: {
      tickers: {
        type: "array",
        required: true,
        description: "1–500 tickers to aggregate.",
        items: { type: "string" },
      },
      weights: {
        type: "array",
        required: false,
        description:
          "Optional non-negative weights aligned 1:1 with tickers. Equal-weight when omitted.",
        items: { type: "number" },
      },
      signal_quality_min_quintile: {
        type: "integer",
        required: false,
        description:
          "Optional 1–5 gate on signal_quality_quintile. Members below this still appear in the response but don't contribute to the aggregate.",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "residual_signal_basket_v2",
      legacy_cost_usd: 0.02,
    },
    performance: {
      avg_latency_ms: 180,
      p95_latency_ms: 320,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["erm3_models"],
    },
    tags: ["risk", "signal", "mean-reversion", "stat-arb", "basket", "factor"],
  },
  {
    id: "universe-members",
    name: "Universe Members",
    description:
      "Active membership of a named universe (uni_mc_50/500/1000/3000 or uni_dv_*) at a given trading day (latest by default). Active = monthly universe_mask AND daily validity gate. Response carries the symbols + tickers, a counts block (active / in_universe_mask / inactive_from_validity), and a `mask_as_of` month-end stamp so callers can tell whether membership changed because of a new month's mask vs a daily validity failure. Foundational endpoint for any cross-sectional workflow that needs to align on the canonical universe without the SDK.",
    endpoint: "/api/universe/{name}/members",
    method: "GET",
    parameters: {
      name: {
        type: "string",
        required: true,
        description:
          "Universe label from the KNOWN_UNIVERSES registry: uni_mc_50 | uni_mc_500 | uni_mc_1000 | uni_mc_3000 | uni_dv_50 | uni_dv_500 | uni_dv_1000 | uni_dv_3000.",
      },
      teo: {
        type: "string",
        required: false,
        description: "Observation date YYYY-MM-DD (default latest teo).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "universe_members_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 90,
      p95_latency_ms: 180,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["ds_masks"],
    },
    tags: ["universe", "membership", "foundational", "mask"],
  },
  {
    id: "etf-factor-returns",
    name: "ETF Factor Returns (Public Scope)",
    description:
      "One-teo snapshot of close + trailing-window total returns (1d / 21d / 63d / 252d) for SPY + the 11 GICS sector SPDR ETFs (XLE/XLB/XLI/XLY/XLP/XLV/XLF/XLK/XLC/XLU/XLRE). Public scope only — the broader BWMACRO factor roster (subsectors, style, macro, broad-market) is NOT exposed here by design. Use this to pair with /industry-panel for the daily 'what's happening at the market and sector index level' read. Tickers outside the public scope return 400.",
    endpoint: "/api/etf/factor-returns",
    method: "GET",
    parameters: {
      sleeve: {
        type: "string",
        required: false,
        description:
          "Filter to 'market' (SPY only), 'sector' (11 GICS sectors), or 'all' (default).",
      },
      tickers: {
        type: "string",
        required: false,
        description:
          "Comma-separated subset of in-scope tickers (intersected with sleeve filter).",
      },
      teo: {
        type: "string",
        required: false,
        description: "Observation date YYYY-MM-DD (default latest teo in ds_etf).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "etf_factor_returns_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 110,
      p95_latency_ms: 240,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.99,
      update_frequency: "daily",
      sources: ["ds_etf"],
    },
    tags: ["etf", "factor", "sector", "returns", "panel", "foundational"],
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
      cost_usd: 0.01,
      cost_per_extra_year_usd: 0.005,
      currency: "USD",
      min_charge: 0.02,
      billing_code: "portfolio_returns_v3",
      legacy_cost_usd: 0.004,
      legacy_min_charge: 0.01,
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
      cost_usd: 0.15,
      currency: "USD",
      billing_code: "portfolio_risk_index_v3",
      legacy_cost_usd: 0.03,
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
    name: "Snapshot — portfolio or ticker",
    description:
      "Canonical JSON snapshot via `POST /api/snapshot` for either a weighted portfolio (`type: \"portfolio\"`) or a single name (`type: \"ticker\"`, a shim over `/metrics` + `/decompose`): L3 explained-risk decomposition, hedge ratios, frozen-weight return attribution, cumulative return / drawdown, risk summary. Ticker mode also returns `snapshot.ticker_meta` with sector/subsector ETFs and the active L3 factor list. Also serves the bundled PDF/JSON via `POST /api/portfolio/risk-snapshot`. Single bundled charge per request; uses internal data access only (no double-billing).",
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
      cost_usd: 1.25,
      currency: "USD",
      billing_code: "risk_snapshot_pdf_v2",
      legacy_cost_usd: 0.25,
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
    id: "artifact-render",
    name: "Artifact registry render",
    description:
      "Deterministic render-once artifact from the intelligence registry (stock / fund / filer / client_portfolio). " +
      "Invokes render-svc `POST /artifacts/render`; product alias `GET /api/snapshot/{entity_kind}/{id}/panels/{slug}`. " +
      "Stock O.6: l3_explained_risk_hbar, hedge_notionals_hbar, hedge_depth_retained, watchlist_er_stacked. " +
      "Returns JSON or PNG/SVG (base64). Chat: `render_artifact`; MCP: `riskmodels_render_artifact`.",
    endpoint: "/artifacts/render",
    method: "POST",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "Artifact slug (e.g. l3_explained_risk_hbar, top_holdings_erm_stacked)",
      },
      version: {
        type: "string",
        required: false,
        description: "Semantic version tag, default v1",
        default: "v1",
      },
      subject_id: {
        type: "string",
        required: true,
        description: "BW-STOCK-…, BW-FUND-…, BW-FILER-…, BW-PORTFOLIO-…, or BW-STOCK-WATCHLIST",
      },
      as_of: {
        type: "string",
        required: false,
        description: "YYYY-MM-DD or latest",
        default: "latest",
      },
      format: {
        type: "string",
        required: false,
        description:
          "json | png | svg | figure. 'figure' returns a Plotly figure spec for " +
          "client-side rendering (Plotly-backed slugs only; others → 400).",
        enum: ["json", "png", "svg", "figure"],
        default: "json",
      },
      params: {
        type: "object",
        required: false,
        // Applicability is spelled out from ARTIFACT_SLUG_PARAMS rather than
        // written by hand. This entry named two slugs and two params while
        // render-svc enforced seven across ten slugs, so an agent reading the
        // registry could not learn that `layers` or `benchmark` existed
        // (G.54). `artifact-capability-params.test.ts` fails if the two
        // diverge again.
        description: ARTIFACT_RENDER_PARAMS_DESCRIPTION,
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.25,
      currency: "USD",
      billing_code: "artifact_render_v2",
      legacy_cost_usd: 0.05,
    },
    performance: {
      avg_latency_ms: 1200,
      p95_latency_ms: 4000,
      availability_sla: 99.5,
      rate_limit_per_minute: 30,
    },
    confidence: {
      data_quality_score: 0.98,
      update_frequency: "daily",
      sources: ["Funds_DAG", "ERM3", "render-svc"],
    },
    tags: ["artifact", "registry", "render", "fund", "filer"],
  },
  {
    id: "artifact-as-of",
    name: "Artifact pre-rendered vintages",
    description:
      "Which as_of dates are pre-rendered for one (slug, subject_id), with the formats stored under each " +
      "and their object URIs. Read-only discovery for pre-rendered subject kinds (BW-COHORT-*, BW-FILER-*): " +
      "cohort as_of=latest resolves to the newest date listed here; filers must pass one of these dates " +
      "explicitly. 404 when nothing is pre-rendered (body says unbuilt slug vs unknown subject). " +
      "Companion to GET /api/artifacts/capability.",
    endpoint: "/artifacts/as-of",
    method: "GET",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "Artifact slug (e.g. risk_dna_stacked, lag_erosion, entity_header)",
      },
      subject_id: {
        type: "string",
        required: true,
        description: "BW-COHORT-…, BW-FILER-…, BW-FUND-…, or BW-STOCK-… (both filer id spellings are searched)",
      },
      version: {
        type: "string",
        required: false,
        description: "Semantic version tag, default v1",
        default: "v1",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0,
      currency: "USD",
      billing_code: "artifact_as_of_v1",
    },
    performance: {
      avg_latency_ms: 300,
      p95_latency_ms: 1200,
      availability_sla: 99.5,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 1.0,
      update_frequency: "daily",
      sources: ["render-svc"],
    },
    tags: ["artifact", "registry", "discovery", "cohort", "filer"],
  },
  {
    id: "artifact-capability",
    name: "Artifact render capability",
    description:
      "The verified (slug, subject_kind) pairs the artifact registry can render, each slug's applicable " +
      "params, the pairs measured and refused (with reasons), and how as_of=latest resolves per pair. " +
      "Derived from the audited capability table on every request. Call before riskmodels_render_artifact " +
      "to learn what renders for a subject kind; GET /api/artifacts/as-of lists the pre-rendered dates " +
      "for one subject.",
    endpoint: "/artifacts/capability",
    method: "GET",
    parameters: {
      subject_kind: {
        type: "string",
        required: false,
        description: "Narrow pairs to one kind",
        enum: ["fund", "etf", "filer_13f", "cohort", "stock", "client_portfolio"],
      },
      slug: {
        type: "string",
        required: false,
        description: "Narrow pairs to one artifact slug",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0,
      currency: "USD",
      billing_code: "artifact_capability",
    },
    performance: {
      avg_latency_ms: 20,
      p95_latency_ms: 80,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 1.0,
      update_frequency: "daily",
      sources: ["render-svc"],
    },
    tags: ["artifact", "registry", "discovery"],
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
        description: "Macro factor keys (inflation, term_spread, short_rates, credit, oil, gold, usd, volatility, bitcoin, vix_spot); default all ten. volatility=VXX futures, vix_spot=FRED VIXCLS — different series. Legacy aliases accepted (dxy→usd, vix→vix_spot, ust10y2y→term_spread).",
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
      cost_usd: 0.01,
      currency: "USD",
      billing_code: "factor_correlation_v2",
      legacy_cost_usd: 0.002,
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
          "Comma-separated factor keys: inflation, term_spread, short_rates, credit, oil, gold, usd, volatility, bitcoin, vix_spot. Aliases btc/xau/wti/gld and legacy v1 names (dxy, vix, ust10y2y) normalized. Default all ten.",
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
      cost_usd: 0.005,
      currency: "USD",
      billing_code: "macro_factor_series_v2",
      legacy_cost_usd: 0.001,
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
      cost_usd: 0.015,
      currency: "USD",
      billing_code: "cli_query_v2",
      legacy_cost_usd: 0.003,
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
  {
    id: "fund-search",
    name: "Fund Search & Discovery",
    description:
      "Search the funds universe by ticker, fund name, or equity style 9-box cohort. " +
      "Returns a list of FundRow records (bw_fund_id, ticker, fund_name, equity_style_9box, " +
      "asset_class, total_assets, etc.) for downstream calls to /api/funds/{bw_fund_id}/*. " +
      "Free for users (no per-request cost) — discovery is intentionally unbilled so quants and agents " +
      "can resolve a bw_fund_id without paying. Per-fund follow-up calls are metered.",
    endpoint: "/api/funds/search",
    method: "GET",
    parameters: {
      q: {
        type: "string",
        required: false,
        description: "Full-text search on ticker or fund name (case-insensitive ilike).",
      },
      equity_style_9box: {
        type: "string",
        required: false,
        description: "Style slug (e.g. 'large-blend') or canonical name ('Large Blend').",
      },
      primary: {
        type: "boolean",
        required: false,
        description: "If true, filters to share-class primaries only.",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max rows returned (default 50, max 500).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.0,
      currency: "USD",
      billing_code: "fund_search_v1",
    },
    performance: {
      avg_latency_ms: 60,
      p95_latency_ms: 200,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["funds", "funds_latest"],
    },
    tags: ["funds", "search", "discovery", "free"],
  },
  {
    id: "fund-metrics",
    name: "Latest Fund Metrics",
    description:
      "Latest knowledge-mode portfolio return decomposition + diagnostics for a single mutual fund. " +
      "Returns the gross / market / sector / subsector / idiosyncratic return components, the " +
      "identity_residual, ERM3 universe coverage (weight_sum), n_holdings_active, effective_n (HHI-derived " +
      "diversification), and top10_weight_sum. Resolves bw_fund_id against public.funds + public.funds_latest. " +
      "Bitemporal lineage surfaces as X-Data-As-Of (report_date) and X-Data-Filing-Date headers; " +
      "v1 returns the latest knowledge-mode answer only (no ?as_of= / ?mode= — deferred to v2).",
    endpoint: "/api/funds/{bw_fund_id}",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical fund id (format: BW-FUND-{series_id}, e.g. BW-FUND-S000004310)",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fund_metrics_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["funds", "funds_latest"],
    },
    tags: ["funds", "metrics", "knowledge-mode"],
  },
  {
    id: "fund-portfolio-history",
    name: "Fund Portfolio History",
    description:
      "Per-fund time series of portfolio_*_return components, identity_residual, and diagnostics " +
      "(weight_sum, n_holdings_active, effective_n, top10_weight_sum) from Slice 8's per-fund " +
      "ds_portfolio.zarr on GCS. One row per teo (month-end). Optional ?start_date and ?end_date " +
      "query params (inclusive, YYYY-MM-DD) trim the panel; default returns the full history.",
    endpoint: "/api/funds/{bw_fund_id}/portfolio",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical fund id (format: BW-FUND-{series_id})",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Inclusive lower bound, YYYY-MM-DD",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Inclusive upper bound, YYYY-MM-DD",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fund_portfolio_history_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["ds_portfolio.zarr", "funds"],
    },
    tags: ["funds", "history", "time-series"],
  },
  {
    id: "fund-nav-history",
    name: "Fund NAV History",
    description:
      "Per-fund NAV time series from yfinance (Funds_DAG fund_nav_zarr asset). One row per teo " +
      "(month-end) with nav_close (month-end close) and nav_return_monthly (pct_change of " +
      "consecutive closes). Pairs with /portfolio: portfolio returns are derived from quarterly " +
      "13F holdings; NAV returns are what investors actually realised. The gap surfaces " +
      "intra-quarter trading, fees, and cash drag not visible in 13F. Optional ?start_date and " +
      "?end_date trim the panel; default returns the full history.",
    endpoint: "/api/funds/{bw_fund_id}/nav",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical fund id (format: BW-FUND-{series_id})",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Inclusive lower bound, YYYY-MM-DD",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Inclusive upper bound, YYYY-MM-DD",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fund_nav_history_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "daily",
      sources: ["ds_nav.zarr", "funds"],
    },
    tags: ["funds", "history", "time-series", "nav"],
  },
  {
    id: "fund-holdings",
    name: "Fund Top-N Holdings",
    description:
      "Top-N current holdings for a mutual fund at the latest teo. Reads adj_mv (symbol, teo) " +
      "and aum_erm3 (teo,) from Slice 5's per-fund ds_ph.zarr on GCS, sorts symbols by adj_mv " +
      "descending, and returns the top N with weight = adj_mv / aum_erm3. Default 25; caller " +
      "may request up to 1000 via ?limit=. Symbols are bw_sym_id; resolve to ticker via " +
      "/api/data/symbols/batch if needed.",
    endpoint: "/api/funds/{bw_fund_id}/holdings",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical fund id (format: BW-FUND-{series_id})",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max holdings to return (default 25, capped 1000)",
        default: 25,
        min: 1,
        max: 1000,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fund_holdings_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["ds_ph.zarr", "funds"],
    },
    tags: ["funds", "holdings", "knowledge-mode"],
  },
  {
    id: "fund-hedge",
    name: "Fund Hedge Ratios",
    description:
      "Latest L1/L2/L3 ETF hedge ratios for a mutual fund. Reads L{1,2,3}_HR (teo, symbol) " +
      "from Slice 7's per-fund ds_hr.zarr at the latest teo and returns per-level lists of " +
      "{etf, hr} dropping NaN entries. Use these to compose hedging baskets at each ERM3 " +
      "factor level.",
    endpoint: "/api/funds/{bw_fund_id}/hedge",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical fund id (format: BW-FUND-{series_id})",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "fund_hedge_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["ds_hr.zarr", "funds"],
    },
    tags: ["funds", "hedge-ratios", "knowledge-mode"],
  },
  {
    id: "style-cohort-metrics",
    name: "Style Cohort Latest Metrics",
    description:
      "Latest portfolio return decomposition + diagnostics for one of the 9-box style cells, " +
      "aggregated across all funds in the cell. Returns both equal-weight (EW) and " +
      "market-value-weighted (MV) cohort portfolios side-by-side. Sourced from Slice 6's " +
      "per-cell ds_portfolio.zarr (latest snapshot in style_portfolios_latest). " +
      "The differentiated wedge — Morningstar reports per-fund metrics but doesn't expose " +
      "cohort aggregates with this attribution depth.",
    endpoint: "/api/funds/style/{slug}",
    method: "GET",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description:
          "9-box style slug (large-value, large-blend, large-growth, mid-*, small-*).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "style_cohort_metrics_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["style_portfolios_latest"],
    },
    tags: ["funds", "cohort", "knowledge-mode", "differentiated-wedge"],
  },
  {
    id: "style-cohort-rankings",
    name: "Style Cohort Top-N Rankings",
    description:
      "Top-N rankings within a 9-box style cell × cohort_type × metric × period_window × " +
      "weighting. cohort_type ∈ {symbol, sector, fund}. period_window ∈ {1m, 3m, 12m, 36m}. " +
      "weighting ∈ {ew, mv} — ignored for cohort_type=fund (writer stores 'ew' placeholder). " +
      "Top-N capped at 50 (Slice 9 storage ceiling).",
    endpoint: "/api/funds/style/{slug}/rankings/{cohort_type}",
    method: "GET",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "9-box style slug",
      },
      cohort_type: {
        type: "string",
        required: true,
        description: "One of: symbol, sector, fund",
        enum: ["symbol", "sector", "fund"],
      },
      metric: {
        type: "string",
        required: true,
        description: "Metric to rank by (e.g. weight, gross_return, n_funds_holding).",
      },
      period_window: {
        type: "string",
        required: false,
        description: "Trailing window (1m / 3m / 12m / 36m). Default 1m.",
        default: "1m",
        enum: ["1m", "3m", "12m", "36m"],
      },
      weighting: {
        type: "string",
        required: false,
        description: "Cohort weighting (ew / mv). Default mv. Ignored for cohort_type=fund.",
        default: "mv",
        enum: ["ew", "mv"],
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max rows to return (default 25, capped 50).",
        default: 25,
        min: 1,
        max: 50,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "style_cohort_rankings_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["style_rankings_top"],
    },
    tags: ["funds", "cohort", "rankings", "differentiated-wedge"],
  },
  {
    id: "style-cohort-portfolio-history",
    name: "Style Cohort Portfolio History",
    description:
      "Per-cell cohort portfolio time series. Reads Slice 6's per-cell ds_portfolio.zarr " +
      "(dims teo, weighting). Each row carries both EW and MV blocks side-by-side. Optional " +
      "?start_date and ?end_date (inclusive YYYY-MM-DD) trim the panel.",
    endpoint: "/api/funds/style/{slug}/portfolio",
    method: "GET",
    parameters: {
      slug: { type: "string", required: true, description: "9-box style slug" },
      start_date: { type: "string", required: false, description: "Inclusive lower bound YYYY-MM-DD" },
      end_date: { type: "string", required: false, description: "Inclusive upper bound YYYY-MM-DD" },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "style_cohort_portfolio_history_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["portfolio_style/{Cell_Name}/ds_portfolio.zarr"],
    },
    tags: ["funds", "cohort", "history", "time-series"],
  },
  {
    id: "style-cohort-holdings",
    name: "Style Cohort Top-N Holdings",
    description:
      "Top-N cohort holdings at the latest teo. Reads weight (teo, symbol, weighting) and " +
      "contribution_* / n_funds_holding from Slice 5b's per-cell ds_symbols.zarr. Sorted by " +
      "weight desc. ?weighting defaults to mv (Morningstar-comparable); switch to ew for " +
      "equal-weight cohort exposures. ?limit default 25, capped 100.",
    endpoint: "/api/funds/style/{slug}/holdings",
    method: "GET",
    parameters: {
      slug: { type: "string", required: true, description: "9-box style slug" },
      weighting: {
        type: "string",
        required: false,
        description: "ew or mv (default mv)",
        default: "mv",
        enum: ["ew", "mv"],
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max holdings (default 25, capped 100)",
        default: 25,
        min: 1,
        max: 100,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "style_cohort_holdings_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: ["equity_style_9box/{Cell_Name}/ds_symbols.zarr"],
    },
    tags: ["funds", "cohort", "holdings", "differentiated-wedge"],
  },
  {
    id: "bench-active-custom",
    name: "Custom Benchmark Active Weights",
    description:
      "Custom benchmark active weights — conviction vs own-holdings cap benchmark (ff_own) or " +
      "9-box style-cell benchmark. Same route as the free static benchmark fit " +
      "(GET /api/data/benchmark-fit); the `benchmark` param selects the plane: static aliases " +
      "(SPY, 70/30, …) stay free on the gateway plane, while ff_own, cell_<9box-slug> " +
      "(e.g. cell_large-growth), and `all` (fan-out: SPY + ff_own + the subject's declared " +
      "style cell, one call) are billed at this capability. ff_own builds a free-float-cap " +
      "benchmark of the subject's own holdings from the ERM3 cap store (free_float_market_cap " +
      "preferred, market_cap fallback) — held symbols without a valid cap are dropped and " +
      "counted in benchmark_provenance (cap_var, cap_coverage, caps_as_of, n_cap_dropped), " +
      "never synthesized. cell_<slug> uses the cell's MV weight surface at the latest teo ≤ " +
      "the subject's teo. Returns the BenchmarkFit shape (active share, active-weight RMS, " +
      "overlap, top over/underweights) with benchmark_kind + benchmark_provenance. Readiness " +
      "gate: benches under development (hollow trailing teos / shallow history) are blocked " +
      "with HTTP 409 before billing — see lib/benchmark-registry.ts; on `all` they move to " +
      "omitted[] with reason under_development.",
    endpoint: "/api/data/benchmark-fit",
    method: "GET",
    parameters: {
      subject: {
        type: "string",
        required: true,
        description:
          "BW-* portfolio id (BW-FUND-…, BW-FILER-…, BW-ETF-…) or an ETF ticker (→ BW-ETF-{TICKER})",
      },
      benchmark: {
        type: "string",
        required: true,
        description:
          "ff_own | cell_<9-box slug> (large-value … small-growth) | all. Static aliases (SPY, 70/30, …) are served free via the same param.",
      },
      as_of: {
        type: "string",
        required: false,
        description: "YYYY-MM-DD upper bound on the subject teo (benchmark surfaces then at their latest teo ≤ the subject's)",
      },
      top: {
        type: "integer",
        required: false,
        description: "Top-N over/underweights (default 10, max 100)",
        default: 10,
        min: 1,
        max: 100,
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "bench_active_custom_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 800,
      p95_latency_ms: 4000,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "daily",
      sources: ["ds_market_cap", "equity_style_9box/ds_symbols", "bw_bench_id/ds_ph"],
    },
    tags: ["funds", "benchmark", "active-weights", "conviction", "style-cell"],
  },
  {
    id: "fund-snapshot-json",
    name: "Fund Snapshot (JSON)",
    description:
      "Composed JSON snapshot for a single mutual fund. Bundles registry + latest metrics + " +
      "top-25 holdings + L1/L2/L3 hedge + 12-month portfolio time series + cohort context " +
      "(fund's rank within its 9-box cell on every metric we rank, expressed as rank N of " +
      "cohort_size). The matching server-rendered PDF is /funds/snapshot.pdf/{bw_fund_id} " +
      "(Stage D.2).",
    endpoint: "/api/funds/snapshot/{bw_fund_id}",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description: "Funds_DAG canonical fund id (BW-FUND-{series_id}).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.05,
      currency: "USD",
      billing_code: "fund_snapshot_json_v2",
      legacy_cost_usd: 0.01,
    },
    performance: {
      avg_latency_ms: 300,
      p95_latency_ms: 800,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: [
        "funds",
        "funds_latest",
        "style_rankings_top",
        "style_portfolios_latest",
        "ds_portfolio.zarr",
        "ds_ph.zarr",
        "ds_hr.zarr",
      ],
    },
    tags: ["funds", "snapshot", "tearsheet", "knowledge-mode"],
  },
  {
    id: "fund-snapshot-pdf",
    name: "Fund Snapshot (PDF)",
    description:
      "Server-rendered F1 fund tearsheet PDF. Same composition as " +
      "`/api/funds/snapshot/{bw_fund_id}` (JSON), rendered via Playwright " +
      "through `app/(print)/render-snapshot/funds/[bw_fund_id]/page.tsx`. " +
      "Letter landscape, single page. Cached 24h per (user, bw_fund_id, " +
      "report_date); cache hits return $0 with `X-Cache: HIT`.",
    endpoint: "/api/funds/snapshot.pdf/{bw_fund_id}",
    method: "GET",
    parameters: {
      bw_fund_id: {
        type: "string",
        required: true,
        description: "Funds_DAG canonical fund id (BW-FUND-{series_id}).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 1.25,
      currency: "USD",
      billing_code: "fund_snapshot_pdf_v2",
      legacy_cost_usd: 0.25,
    },
    performance: {
      avg_latency_ms: 1200,
      p95_latency_ms: 3500,
      availability_sla: 99.5,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: [
        "funds",
        "funds_latest",
        "style_rankings_top",
        "style_portfolios_latest",
        "ds_portfolio.zarr",
        "ds_ph.zarr",
        "ds_hr.zarr",
        "ds_nav.zarr",
      ],
    },
    tags: ["funds", "snapshot", "pdf", "tearsheet", "knowledge-mode"],
  },
  {
    id: "style-cohort-snapshot-json",
    name: "Style Cohort Snapshot (JSON)",
    description:
      "Composed JSON snapshot for a 9-box style cell — the differentiated wedge vs Morningstar. " +
      "Bundles cohort metrics (EW + MV) + top-25 cohort holdings (MV) + 12-month cohort " +
      "portfolio history (both weightings) + top-10 funds in cell + top-15 symbols in cell. " +
      "Matching server-rendered PDF is /funds/style/{slug}/snapshot.pdf (Stage D.2).",
    endpoint: "/api/funds/style/{slug}/snapshot",
    method: "GET",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "9-box style slug (large-blend, etc.).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "style_cohort_snapshot_json_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 300,
      p95_latency_ms: 800,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: [
        "style_portfolios_latest",
        "style_rankings_top",
        "portfolio_style/{Cell_Name}/ds_portfolio.zarr",
        "equity_style_9box/{Cell_Name}/ds_symbols.zarr",
      ],
    },
    tags: ["funds", "snapshot", "cohort", "differentiated-wedge"],
  },
  {
    id: "style-cohort-snapshot-pdf",
    name: "Style Cohort Snapshot (PDF)",
    description:
      "Server-rendered C1 cohort tearsheet PDF. Same composition as " +
      "`/api/funds/style/{slug}/snapshot` (JSON), rendered via Playwright " +
      "through `app/(print)/render-snapshot/funds/style/[slug]/page.tsx`. " +
      "Letter landscape, single page. Cached 24h per (user, slug, " +
      "report_date); cache hits return $0 with `X-Cache: HIT`.",
    endpoint: "/api/funds/style/{slug}/snapshot.pdf",
    method: "GET",
    parameters: {
      slug: {
        type: "string",
        required: true,
        description: "9-box style slug (large-blend, etc.).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.5,
      currency: "USD",
      billing_code: "style_cohort_snapshot_pdf_v2",
      legacy_cost_usd: 0.1,
    },
    performance: {
      avg_latency_ms: 1200,
      p95_latency_ms: 3500,
      availability_sla: 99.5,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "monthly",
      sources: [
        "style_portfolios_latest",
        "style_rankings_top",
        "portfolio_style/{Cell_Name}/ds_portfolio.zarr",
        "equity_style_9box/{Cell_Name}/ds_symbols.zarr",
      ],
    },
    tags: ["funds", "snapshot", "cohort", "pdf", "differentiated-wedge"],
  },

  // ===========================================================================
  // 13F FILER CAPABILITIES (D.8 Phase 1)
  // Plan: BWMACRO/docs/13f_pipeline_plan.md
  // ===========================================================================
  {
    id: "filer-search",
    name: "13F Filer Search & Discovery",
    description:
      "Search the 13F filer universe by name, CIK, LEI, or filer_type/aum_tier cohort. " +
      "Returns a list of FilerRow records (bw_filer_id, cik, name, filer_type, aum_tier, " +
      "latest_aum_usd, etc.) for downstream calls to /api/13f/filers/{bw_filer_id}/*. " +
      "Optional modelable_only filter restricts results to filers whose in-ERM3 sub-portfolio " +
      "carries signal value (passes the modelability gate). Free for users — discovery is " +
      "unbilled; per-filer follow-up calls are metered.",
    endpoint: "/api/13f/filers/search",
    method: "GET",
    parameters: {
      q: {
        type: "string",
        required: false,
        description: "Full-text search on name, CIK, or LEI (case-insensitive ilike).",
      },
      filer_type: {
        type: "string",
        required: false,
        description: "Filer type filter (e.g. 'hedge_fund', 'investment_adviser').",
      },
      aum_tier: {
        type: "string",
        required: false,
        description: "AUM tier bucket from filer_master.",
      },
      modelable_only: {
        type: "boolean",
        required: false,
        description: "If true, restricts to filers passing the modelability gate.",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Max rows returned (default 50, max 500).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.0,
      currency: "USD",
      billing_code: "filer_search_v1",
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 250,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.95,
      update_frequency: "quarterly",
      sources: ["filers", "filer_portfolios_latest"],
    },
    tags: ["13f", "filers", "search", "discovery", "free"],
  },
  {
    id: "filer-metrics",
    name: "Latest 13F Filer Metrics",
    description:
      "Latest knowledge-mode portfolio metrics for a single 13F filer. Returns diagnostics " +
      "(weight_sum, n_holdings_active, effective_n, top10_weight_sum), AUM (total_aum_usd + " +
      "aum_in_erm3 — the latter is the absolute scale of holdings inside the ERM3 universe), " +
      "ERM3-coverage modelability inputs, and the portfolio-derived 9-box style attribution " +
      "(portfolio_style_hhi, dominant_9box, effective_n_styles). Return components are NULL " +
      "until D.8 Phase 2 (the security-master ↔ ERM3 attribution bridge). NAV is permanently absent — filers " +
      "have no NAV time series. Resolves bw_filer_id against public.filers + " +
      "public.filer_portfolios_latest.",
    endpoint: "/api/13f/filers/{bw_filer_id}",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik} or BW-FILER-CRD{crd}).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "filer_metrics_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 80,
      p95_latency_ms: 150,
      availability_sla: 99.9,
      rate_limit_per_minute: 120,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: ["filers", "filer_portfolios_latest"],
    },
    tags: ["13f", "filers", "metrics", "knowledge-mode"],
  },
  {
    id: "filer-holdings",
    name: "13F Filer Top Holdings",
    description:
      "Top-N current holdings for a 13F filer at the latest report_date. Reads per-filer " +
      "ds_ph.zarr from GCS. Each holding carries security_id (post-D.8.1 = bw_sym_id; pre-" +
      "migration = a raw 9-char security identifier), adj_mv, and weight (fraction of total " +
      "in-portfolio AUM). Default N=25, max 1000.",
    endpoint: "/api/13f/filers/{bw_filer_id}/holdings",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik}). " +
          "Composite entities (BW-SYNTH-*) are served by the same route.",
      },
      limit: {
        type: "integer",
        required: false,
        description: "Top-N to return (default 25, max 1000).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "filer_holdings_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 250,
      p95_latency_ms: 600,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: ["bw_filer_id/{id}/ds_ph.zarr", "filers"],
    },
    tags: ["13f", "filers", "holdings"],
  },
  {
    id: "filer-portfolio-history",
    name: "13F Filer Portfolio History",
    description:
      "Per-filer portfolio time series of diagnostics + AUM + style attribution from per-" +
      "filer ds_portfolio.zarr on GCS. One row per teo (quarter-end). Optional ?start_date " +
      "and ?end_date trim the panel. Return components (portfolio_*_return, identity_residual) " +
      "are NULL until D.8 Phase 2 (the security-master ↔ ERM3 attribution bridge).",
    endpoint: "/api/13f/filers/{bw_filer_id}/portfolio",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik}).",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Inclusive lower bound, YYYY-MM-DD.",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Inclusive upper bound, YYYY-MM-DD.",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "filer_portfolio_history_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: ["bw_filer_id/{id}/ds_portfolio.zarr", "filers"],
    },
    tags: ["13f", "filers", "history", "time-series"],
  },
  {
    id: "filer-concentration",
    name: "13F Filer Concentration Summary",
    description:
      "Quarter-end concentration panel from per-filer ds_portfolio.zarr on GCS. " +
      "Returns median and latest effective N, top-5 / top-10 weight share, and weight HHI " +
      "over an optional ?start_date / ?end_date window.",
    endpoint: "/api/13f/filers/{bw_filer_id}/concentration",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik}).",
      },
      start_date: {
        type: "string",
        required: false,
        description: "Inclusive lower bound, YYYY-MM-DD.",
      },
      end_date: {
        type: "string",
        required: false,
        description: "Inclusive upper bound, YYYY-MM-DD.",
      },
    },
    pricing: {
      model: "per_request",
      tier: "baseline",
      cost_usd: 0.02,
      currency: "USD",
      billing_code: "filer_concentration_v2",
      legacy_cost_usd: 0.005,
    },
    performance: {
      avg_latency_ms: 200,
      p95_latency_ms: 500,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: ["bw_filer_id/{id}/ds_portfolio.zarr", "filers"],
    },
    tags: ["13f", "filers", "concentration"],
  },
  {
    id: "filer-snapshot-json",
    name: "13F Filer Snapshot (JSON)",
    description:
      "Single-call composed snapshot for a 13F filer: registry + latest metrics + top 25 " +
      "holdings + 12mo portfolio history + cohort ranks (filer_type and aum_tier partitions) " +
      "+ portfolio-derived 9-box style attribution + ERM3 coverage diagnostics + modelability " +
      "flag. Permanently no NAV (surfaced as _metadata.nav_applicable: false) — filers have " +
      "no NAV time series. Hedge ratios are Phase 3 (D.8.10) and absent today.",
    endpoint: "/api/13f/filers/{bw_filer_id}/snapshot",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik}). " +
          "Composite entities (BW-SYNTH-*) are served by the same route.",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.05,
      currency: "USD",
      billing_code: "filer_snapshot_json_v2",
      legacy_cost_usd: 0.01,
    },
    performance: {
      avg_latency_ms: 350,
      p95_latency_ms: 900,
      availability_sla: 99.9,
      rate_limit_per_minute: 60,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: [
        "filers",
        "filer_portfolios_latest",
        "filer_rankings_top",
        "bw_filer_id/{id}/ds_ph.zarr",
        "bw_filer_id/{id}/ds_portfolio.zarr",
      ],
    },
    tags: ["13f", "filers", "snapshot", "differentiated-wedge"],
  },
  {
    id: "filer-snapshot-pdf",
    name: "13F Filer Snapshot (PDF)",
    description:
      "Rendered 1-page tearsheet PDF for a 13F filer. Same content as filer-snapshot-json: " +
      "filer registry, top holdings, portfolio history, cohort ranks, 9-box style attribution, " +
      "and coverage diagnostics. NAV section is intentionally absent (filers have no NAV).",
    endpoint: "/api/13f/filers/{bw_filer_id}/snapshot.pdf",
    method: "GET",
    parameters: {
      bw_filer_id: {
        type: "string",
        required: true,
        description:
          "Funds_DAG canonical filer id (format: BW-FILER-CIK{cik}).",
      },
    },
    pricing: {
      model: "per_request",
      tier: "premium",
      cost_usd: 0.25,
      currency: "USD",
      billing_code: "filer_snapshot_pdf_v2",
      legacy_cost_usd: 0.05,
    },
    performance: {
      avg_latency_ms: 1200,
      p95_latency_ms: 3500,
      availability_sla: 99.5,
      rate_limit_per_minute: 20,
    },
    confidence: {
      data_quality_score: 0.9,
      update_frequency: "quarterly",
      sources: [
        "filers",
        "filer_portfolios_latest",
        "filer_rankings_top",
        "bw_filer_id/{id}/ds_ph.zarr",
        "bw_filer_id/{id}/ds_portfolio.zarr",
      ],
    },
    tags: ["13f", "filers", "snapshot", "pdf", "differentiated-wedge"],
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

function clampYears(years?: number): number {
  if (years == null || !Number.isFinite(years)) return 1;
  return Math.min(15, Math.max(1, Math.round(years)));
}

function unitCostUsd(pricing: PricingModel, years?: number, grandfathered?: boolean): number {
  if (grandfathered && pricing.legacy_cost_usd != null) {
    return pricing.legacy_cost_usd;
  }
  const base = pricing.cost_usd || 0;
  const extra = pricing.cost_per_extra_year_usd;
  if (extra == null || grandfathered) return base;
  return base + extra * (clampYears(years) - 1);
}

export function calculateRequestCost(
  capabilityId: string,
  inputTokens?: number,
  outputTokens?: number,
  itemCount?: number,
  years?: number,
  grandfathered?: boolean,
): number {
  const pricing = getCapabilityPricing(capabilityId);

  switch (pricing.model) {
    case "per_request":
      return unitCostUsd(pricing, years, grandfathered);

    case "per_token": {
      const inRate = grandfathered
        ? (pricing.legacy_input_cost_per_1k ?? pricing.input_cost_per_1k ?? 0)
        : (pricing.input_cost_per_1k || 0);
      const outRate = grandfathered
        ? (pricing.legacy_output_cost_per_1k ?? pricing.output_cost_per_1k ?? 0)
        : (pricing.output_cost_per_1k || 0);
      const inputCost = ((inputTokens || 0) * inRate) / 1000;
      const outputCost = ((outputTokens || 0) * outRate) / 1000;
      return inputCost + outputCost;
    }

    case "per_position": {
      const baseCost = unitCostUsd(pricing, years, grandfathered);
      const itemCost = (itemCount || 1) * baseCost;
      const minCharge = grandfathered
        ? (pricing.legacy_min_charge ?? pricing.min_charge ?? 0)
        : (pricing.min_charge || 0);
      return Math.max(itemCost, minCharge);
    }

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
    years?: number;
    grandfathered?: boolean;
  },
): number {
  return calculateRequestCost(
    capabilityId,
    options?.inputTokens,
    options?.outputTokens,
    options?.itemCount,
    options?.years,
    options?.grandfathered,
  );
}
