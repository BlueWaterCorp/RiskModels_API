/**
 * API Reference endpoint data derived from OPENAPI_SPEC.yaml.
 * Grouped by tag for sidebar navigation.
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export interface EndpointParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface Endpoint {
  path: string;
  method: HttpMethod;
  sidebarLabel?: string;
  summary: string;
  description: string;
  operationId: string;
  tag: string;
  params: EndpointParam[];
  requestBody?: { contentType: string; example?: string };
  responses: { status: number; description: string }[];
}

export interface EndpointGroup {
  name: string;
  description?: string;
  endpoints: Endpoint[];
}

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    name: 'Core Concepts',
    description: 'Quick orientation to the data model. Start here if you want residual returns, betas, or hedge ratios.',
    endpoints: [
      {
        path: '/concepts',
        method: 'get',
        sidebarLabel: 'Understanding the decomposition',
        summary: 'Core outputs: Hedge Ratios, Explained Risk, and Residuals',
        description:
          'RiskModels decomposes every position into four additive layers: Market (L1), Sector (L2), Subsector (L3), and Residual. Each layer produces two key numbers you will use constantly:\n\n• Hedge Ratio (HR): Dollar amount of the layer’s ETF to trade per $1 of the stock to neutralize that exposure.\n• Explained Risk (ER): Fraction of the stock’s variance explained by that layer (adds to 1.0 across layers).\n\nResidual return is what remains after removing the three systematic layers — the part most closely associated with manager/stock-specific judgment.',
        operationId: 'coreConcepts',
        tag: 'Core Concepts',
        params: [],
        responses: [{ status: 200, description: 'Conceptual overview.' }],
      },
      {
        path: '/agents',
        method: 'get',
        sidebarLabel: 'For AI Agents & MCP',
        summary: 'Fastest way to get started with agents',
        description:
          'Use the RiskModels MCP server directly inside Claude, Cursor, Windsurf, or any MCP-capable agent. This is the lowest-friction path for technical users who work with agents.',
        operationId: 'agentOnboarding',
        tag: 'Core Concepts',
        params: [],
        responses: [{ status: 200, description: 'Agent guidance.' }],
      },
    ],
  },
  {
    name: 'Risk Metrics',
    description:
      'The core of the API: hierarchical (L1 market → L2 sector → L3 subsector) decomposition. Get hedge ratios (how many dollars of ETF to trade to neutralize a layer) and explained-risk fractions for any ticker or portfolio.',
    endpoints: [
      {
        path: '/metrics/{ticker}',
        method: 'get',
        summary: 'Latest risk metrics snapshot',
        description:
          'Latest snapshot: current L3 hedge ratios + explained risk (including residual), plus basic risk/price data. Fastest way to answer "what is this stock’s current market/sector/subsector/residual exposure right now?" Includes lstar_rr (Lstar-dispatched residual return at the level the cascade picked) and lstar_level (1/2/3/null) at the canonical 1% threshold — prefer over l3_rr for "best residual" queries. Cost: $0.005/request.',
        operationId: 'getMetrics',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'path', type: 'string', required: true, description: 'Ticker symbol (case-insensitive, max 12 chars).' },
        ],
        responses: [
          { status: 200, description: 'Latest metrics snapshot.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 402, description: 'Insufficient balance.' },
          { status: 404, description: 'Ticker not found in universe.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/ticker-returns',
        method: 'get',
        summary: 'Daily returns time series with rolling hedge ratios',
        description:
          'The most common endpoint for time-series work. Returns daily gross returns + the full set of rolling L3 hedge ratios and explained-risk fractions (including the residual layer). Use this when you need historical residual returns, betas (via HR), or evolving hedge ratios. Cost: $0.02 for 1 year + $0.01 per extra year (max 15).',
        operationId: 'getTickerReturns',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'years', in: 'query', type: 'integer', required: false, description: 'Years of history (1–15).', default: '1' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json (default), parquet, or csv. Tabular formats omit _metadata in body; use X-Risk-* headers.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'Time series of daily returns and rolling hedge ratios.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Ticker not found.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/returns',
        method: 'get',
        summary: 'Daily gross returns time series',
        description: 'Returns daily gross returns for a single stock. Simpler than /ticker-returns (no hedge ratios). Cost: $0.02 for 1 year + $0.01 per extra year.',
        operationId: 'getReturns',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json, parquet, or csv; see OPENAPI_SPEC tabular export section.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'Daily returns.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/l3-decomposition',
        method: 'get',
        summary: 'L3 explained-risk decomposition',
        description:
          'Point-in-time or range L3 decomposition. Returns the hedge ratios and explained risk broken into Market / Sector / Subsector / Residual for the requested window. Great when you want a clean snapshot of current betas and residual exposure without the full time series. Cost: $0.04/call.',
        operationId: 'getL3Decomposition',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'years', in: 'query', type: 'integer', required: false, description: 'Years of history.', default: '1' },
          { name: 'format', in: 'query', type: 'string', required: false, description: 'json, parquet, or csv; see OPENAPI_SPEC tabular export section.', default: 'json' },
        ],
        responses: [
          { status: 200, description: 'L3 decomposition data.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/batch/analyze',
        method: 'post',
        summary: 'Multi-ticker batch analysis (25% discount)',
        description:
          'Fetch metrics for up to 100 tickers in a single call. 25% cheaper per position than individual /ticker-returns calls at 1 year. Cost: $0.015/position, minimum $0.03/call.',
        operationId: 'batchAnalyze',
        tag: 'Risk Metrics',
        params: [
          { name: 'tickers', in: 'body', type: 'array', required: true, description: 'List of ticker symbols (max 100).' },
          { name: 'metrics', in: 'body', type: 'array', required: true, description: 'Whitelist: returns, hedge_ratios (6 HR short keys), full_metrics (L1/L2/L3 ER/HR flat keys + lstar_rr / lstar_level for the Lstar-dispatched residual + level pick). See docs/ERM3_ZARR_API_PARITY.md for zarr L*_ER/L*_HR mapping.' },
          { name: 'years', in: 'body', type: 'integer', required: false, description: 'Years of history.', default: '1' },
        ],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { tickers: ['AAPL', 'MSFT', 'NVDA'], metrics: ['hedge_ratios'], years: 1 },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Batch results keyed by ticker.' },
          { status: 400, description: 'Invalid request or too many tickers.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/returns-decomposition',
        method: 'get',
        summary: 'One-call L1/L2/L3 return decomposition',
        description:
          'Daily gross return + L1/L2/L3 factor / combined-factor / residual return series in a single call from ds_erm3_returns. Replaces 6+ field-by-field round-trips. Add ?include_lstar=true (or ?dispatch=lstar) to also return the Lstar-dispatched residual and per-date level pick. Cost: $0.04/call.',
        operationId: 'getReturnsDecomposition',
        tag: 'Risk Metrics',
        params: [
          { name: 'ticker', in: 'query', type: 'string', required: true, description: 'Ticker symbol.' },
          { name: 'market_factor_etf', in: 'query', type: 'string', required: false, description: 'Market factor ETF (default SPY).', default: 'SPY' },
          { name: 'years', in: 'query', type: 'integer', required: false, description: 'Years of history (1–15).', default: '1' },
          { name: 'include_lstar', in: 'query', type: 'boolean', required: false, description: 'Append lstar + lstar_residual_return arrays. Equivalent to ?dispatch=lstar.', default: 'false' },
          { name: 'threshold', in: 'query', type: 'number', required: false, description: 'Lstar marginal-ER threshold when deriving Lstar (ignored when zarr has lstar_level).', default: '0.01' },
        ],
        responses: [
          { status: 200, description: 'Parallel daily arrays: dates, gross, l1_fr/l2_fr/l3_fr, l1_cfr/l2_cfr/l3_cfr, l1_rr/l2_rr/l3_rr (+ optional lstar/lstar_residual_return).' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Ticker not found.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/industry-panel',
        method: 'get',
        summary: 'Industry peer β cross-section',
        description:
          'Vasicek peer-β cross-section from ds_erm3_industry zarr: beta_mean, beta_variance, n_companies, total_log_mcap_weight by EODHD industry code and cascade level (market / sector / subsector). Default by=level is one row per (industry, level). by=fact is one row per (industry, fact). Multi-fact cells are historical (last L3 day 2021-06-22); latest teo is n_facts=1. Cost: $0.04/call.',
        operationId: 'getIndustryPanel',
        tag: 'Risk Metrics',
        params: [
          { name: 'market_factor_etf', in: 'query', type: 'string', required: false, description: 'Market factor ETF (default SPY).', default: 'SPY' },
          { name: 'teo', in: 'query', type: 'string', required: false, description: 'Observation date YYYY-MM-DD (default latest teo). Also accepts ?date=.' },
          { name: 'level', in: 'query', type: 'string', required: false, description: 'Optional cascade level filter: market | sector | subsector.' },
          { name: 'min_peers', in: 'query', type: 'integer', required: false, description: 'Minimum n_companies filter (industries with fewer peers are dropped). Applied per fact before any by=level collapse.' },
          { name: 'by', in: 'query', type: 'string', required: false, description: 'Grouping: level (default) or fact. fact is 409 on a level-keyed vintage.', default: 'level' },
        ],
        responses: [
          { status: 200, description: 'Per-industry rows with beta_mean / beta_variance / n_companies / total_log_mcap_weight.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Industry panel data unavailable.' },
          { status: 409, description: 'by=fact requested against a level-keyed vintage.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/cohorts',
        method: 'get',
        summary: 'Cohort residual statistics (cross-section)',
        description:
          'Cross-sectional residual statistics by cohort (market + GICS sector) from ds_erm3_cohorts at one teo: residual_mean, residual_sd, residual_skew, residual_p10/p90, mean_pairwise_corr, n_names, n_effective, weight_top1, membership_churn, linked_beta (+link_fit_resid_sd/r2/roll63), cohort_factor_return, cohort_residual_return, cohort_ER, factor_source. link_fit_resid_sd is the residual standard deviation of the 252-day link regression (cohort factor on its parent) — a fit-quality / dispersion measure, NOT a standard error of linked_beta and not a total-uncertainty measure; do not build confidence intervals from it. linked_beta_se is a deprecated alias of the same numbers (deprecated 2026-08-25; removed after the next release), kept only so existing callers do not break. ERM3 residuals are fitted WITHOUT an intercept and so retain each stock alpha — the cross-sectional mean is NOT zero, and residual_mean is what you subtract to demean a relative-ranking signal. residual_sd measures how much selection opportunity a cohort holds; it is an allocation input, not an alpha source. Public scope is SPY + the 11 GICS sector SPDRs. Cost: $0.04/call.',
        operationId: 'getCohorts',
        tag: 'Risk Metrics',
        params: [
          { name: 'cohorts', in: 'query', type: 'string', required: false, description: 'Comma-separated cohort tickers (SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE). Default: all public cohorts.' },
          { name: 'variables', in: 'query', type: 'string', required: false, description: 'Comma-separated variable names. Default: residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective.' },
          { name: 'teo', in: 'query', type: 'string', required: false, description: 'Observation date YYYY-MM-DD (default latest teo). Also accepts ?date=.' },
          { name: 'min_names', in: 'query', type: 'integer', required: false, description: 'Drop cohorts with fewer members — their residual statistics are noise.' },
        ],
        responses: [
          { status: 200, description: 'Per-cohort rows plus disclosures carrying the no-intercept contract read from the store.' },
          { status: 400, description: 'Invalid request, or a cohort outside the addressable set.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Cohort data unavailable.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/cohorts/series',
        method: 'get',
        summary: 'Cohort residual statistics (time series)',
        description:
          'Cohort statistics over a date range, one series per cohort. The demeaning endpoint: request residual_mean at the level your residual is defined against and subtract it. Panel runs from 2000-01-03, though full factor richness begins around 2006. Each cohort reports proxied_fraction — the share of returned days whose factor came from a substitute instrument — because two sector cohorts are majority-proxied over long windows. Cost: $0.15/call.',
        operationId: 'getCohortSeries',
        tag: 'Risk Metrics',
        params: [
          { name: 'cohorts', in: 'query', type: 'string', required: false, description: 'Comma-separated cohort tickers. Default: all public cohorts.' },
          { name: 'variables', in: 'query', type: 'string', required: false, description: 'Comma-separated variable names.' },
          { name: 'start_date', in: 'query', type: 'string', required: false, description: 'Window start YYYY-MM-DD (default panel start).' },
          { name: 'end_date', in: 'query', type: 'string', required: false, description: 'Window end YYYY-MM-DD (default latest teo).' },
          { name: 'min_names', in: 'query', type: 'integer', required: false, description: 'Drop days below this member count.' },
          { name: 'include_proxy_source', in: 'query', type: 'string', required: false, description: "Set 'true' to include the per-day instrument backing the cohort factor." },
        ],
        responses: [
          { status: 200, description: 'Per-cohort series with proxied_fraction and disclosures.' },
          { status: 400, description: 'Invalid request, or a cohort outside the addressable set.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Cohort data unavailable.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/cohorts/roster',
        method: 'get',
        summary: 'Cohort roster and variable catalogue',
        description:
          'Free discovery step: the addressable cohorts, their parent links, the variable catalogue, and the interpretation notes that govern correct use — including the no-intercept contract read directly from the store. Call before /cohorts. Cost: free.',
        operationId: 'getCohortRoster',
        tag: 'Risk Metrics',
        params: [],
        responses: [
          { status: 200, description: 'Public cohorts, variable groups, panel range, and disclosures.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Cohort data unavailable.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/cohorts/pnl-decomposition',
        method: 'post',
        summary: 'Selection vs drift decomposition',
        description:
          "Splits a book's realized residual return into within-cohort SELECTION (earned by holding names that beat their cohort's average residual) and DRIFT (earned purely from net exposure to that average, which accrues on net weight regardless of selection skill). The two sum to the total exactly — an identity, not a fitted attribution. Answers 'was I paid for stock-picking, or for being net long the average stock?'. Weights are constant over the window and are NOT normalized, since rescaling them would change the drift term. Unresolvable positions are named in coverage.dropped, never silently omitted. Realized historical attribution only — not a forecast, backtest, or recommendation. Cost: $0.25/call.",
        operationId: 'postCohortPnlDecomposition',
        tag: 'Risk Metrics',
        params: [
          { name: 'positions', in: 'body', type: 'array', required: true, description: 'Positions as [{ticker, weight}]. Weight may be negative for a short. Max 500.' },
          { name: 'level', in: 'body', type: 'string', required: false, description: "Cascade level: market | sector.", default: 'sector' },
          { name: 'start_date', in: 'body', type: 'string', required: false, description: 'Window start YYYY-MM-DD.' },
          { name: 'end_date', in: 'body', type: 'string', required: false, description: 'Window end YYYY-MM-DD.' },
          { name: 'min_names', in: 'body', type: 'integer', required: false, description: 'Ignore cohort means on days the cohort was thinner than this.' },
          { name: 'include_series', in: 'body', type: 'boolean', required: false, description: 'Include the daily selection/drift series.', default: 'false' },
        ],
        responses: [
          { status: 200, description: 'totals (residual / selection / drift / selection_share), by_cohort, coverage, and disclosures.' },
          { status: 400, description: 'Invalid request.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 404, description: 'Cohort data unavailable.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/rankings/screen',
        method: 'post',
        summary: 'Universe-wide rank screen',
        description:
          'Server-side percentile / decile / sector filters over the full ds_rankings cross-section at one teo (default latest). Replaces N per-ticker /rankings calls. Returns up to 500 rows sorted by rank_ordinal (1 = best, rank_percentile 100 = best). Cost: $0.25/call.',
        operationId: 'postRankingsScreen',
        tag: 'Risk Metrics',
        params: [
          { name: 'metric', in: 'body', type: 'string', required: true, description: 'Ranking metric key: mkt_cap | gross_return | sector_residual | subsector_residual | er_l1 | er_l2 | er_l3.' },
          { name: 'cohort', in: 'body', type: 'string', required: true, description: 'Peer cohort: universe | sector | subsector.' },
          { name: 'window', in: 'body', type: 'string', required: true, description: 'Lookback window: 1d | 21d | 63d | 252d.' },
          { name: 'as_of', in: 'body', type: 'string', required: false, description: 'Observation date YYYY-MM-DD (default latest teo).' },
          { name: 'min_percentile', in: 'body', type: 'number', required: false, description: 'Minimum rank_percentile inclusive (0–100, 100 = best).' },
          { name: 'decile', in: 'body', type: 'integer', required: false, description: 'Decile bucket (1–10, 1 = best).' },
          { name: 'sector_filter', in: 'body', type: 'string', required: false, description: 'Sector ETF ticker filter.' },
          { name: 'limit', in: 'body', type: 'integer', required: false, description: 'Max rows (1–500).', default: '100' },
        ],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { metric: 'subsector_residual', cohort: 'subsector', window: '21d', min_percentile: 95, limit: 50 },
            null,
            2,
          ),
        },
        responses: [
          { status: 200, description: 'Filtered cross-section: rows of {ticker, rank_ordinal, rank_percentile, cohort_size, metric_value, ...}.' },
          { status: 400, description: 'Invalid request body or filter combination.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/etf/factor-returns',
        method: 'get',
        summary: 'ETF factor returns (public scope: SPY + 11 GICS sectors)',
        description:
          'One-teo snapshot of close + trailing 1d / 21d / 63d / 252d total returns for SPY + the 11 GICS sector SPDR ETFs (XLE/XLB/XLI/XLY/XLP/XLV/XLF/XLK/XLC/XLU/XLRE). Public-scope only — the broader BWMACRO factor roster (subsectors, style, macro, broad-market) is NOT exposed through this endpoint by design. Tickers outside the public scope return 400. Pairs with /industry-panel for the daily market + sector index read alongside stock-level industry βs. Cost: $0.02/call.',
        operationId: 'getEtfFactorReturns',
        tag: 'Risk Metrics',
        params: [
          { name: 'sleeve', in: 'query', type: 'string', required: false, description: 'Filter to market (SPY only), sector (11 GICS sectors), or all (default).', default: 'all' },
          { name: 'tickers', in: 'query', type: 'string', required: false, description: 'Comma-separated subset of in-scope tickers (intersected with sleeve filter). Tickers outside the public scope return 400.' },
          { name: 'teo', in: 'query', type: 'string', required: false, description: 'Observation date YYYY-MM-DD (default latest teo in ds_etf).' },
        ],
        responses: [
          { status: 200, description: 'Snapshot: { teo, filter, windows, rows[{ticker, sleeve, name, close, returns{1d,21d,63d,252d}}] }.' },
          { status: 400, description: 'Unknown ticker (outside public scope) or invalid teo format.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
          { status: 503, description: 'Upstream ETF zarr unavailable.' },
        ],
      },
      {
        path: '/batch/lstar',
        method: 'post',
        summary: 'Batch Lstar history (up to 100 tickers)',
        description:
          'Per-ticker daily Lstar level + dispatched hedge ratios + Lstar-dispatched residual return for up to 100 tickers in one call. Companion to lstar_rr / lstar_level in MetricsV3 (single-name latest snapshot); use batch/lstar when you need per-ticker history across a panel. 25% cheaper than repeated GET /lstar. Cost: $0.015/ticker, minimum $0.03/call.',
        operationId: 'postBatchLstar',
        tag: 'Risk Metrics',
        params: [
          { name: 'tickers', in: 'body', type: 'array', required: true, description: 'List of ticker symbols (max 100).' },
          { name: 'market_factor_etf', in: 'body', type: 'string', required: false, description: 'Market factor ETF (default SPY).', default: 'SPY' },
          { name: 'years', in: 'body', type: 'integer', required: false, description: 'Years of history (1–15).', default: '1' },
          { name: 'threshold', in: 'body', type: 'number', required: false, description: 'Marginal-ER threshold for L1/L2/L3 selection.', default: '0.01' },
          { name: 'format', in: 'body', type: 'string', required: false, description: 'json (default; results map keyed by ticker) | parquet | csv (long format).', default: 'json' },
        ],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { tickers: ['AAPL', 'MSFT', 'NVDA'], years: 5 },
            null,
            2,
          ),
        },
        responses: [
          { status: 200, description: 'JSON: results map keyed by ticker, each entry mirrors GET /lstar shape. Parquet/CSV: long rows {ticker, date, lstar, market_hr, sector_hr, subsector_hr, residual_return, ...}.' },
          { status: 400, description: 'Invalid request or too many tickers.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/chat',
        method: 'post',
        summary: 'AI Risk Analyst',
        description: 'Natural language risk analysis via conversational AI (GPT-4). Billed per token.',
        operationId: 'postChat',
        tag: 'Risk Metrics',
        params: [{ name: 'messages', in: 'body', type: 'array', required: true, description: 'Conversation messages.' }],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            { messages: [{ role: 'user', content: 'What is NVDA exposure to tech sector?' }], model: 'kimi-k2.5' },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Assistant reply and optional tool calls.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
    ],
  },
  {
    name: 'Fundamentals',
    description:
      'Point-in-time quarterly fundamentals (TTM profitability + capital-return ratios, leverage, cascade betas, cost-of-capital layer, equity-bridge decomposition, and SEC-sourced raw line items in sec_facts). Realized historical data; no forecasts, no analyst fields.',
    endpoints: [
      {
        path: '/fundamentals/{ticker}',
        method: 'get',
        summary: 'Point-in-time quarterly fundamentals',
        description:
          'Quarterly fundamentals rows, point-in-time filtered: a row is visible only if its filed_date is on or before as_of (never "latest"). Rows carry TTM ROE/ROA/FCF margin, capital-return ratios (payout, retention, buyback, total payout, sustainable growth), leverage, ERM3 cascade betas with provenance, the cost-of-capital layer (cost of equity, cost of debt, book-weight WACC, economic profit), and an equity-bridge decomposition. sec_facts carries raw line items per cell where the serving value is SEC XBRL (revenue, net income, equity, cash flows, dividends, buybacks); vendor-sourced cells are not exposed as raw. Coverage starts ~2009 for most filers. beta_market is a short-half-life conditional beta, so cost_of_equity can fall below the risk-free rate for defensive names — a property of the beta, not an error. Per-symbol per-call only; JSON only. Cost: $0.02/request.',
        operationId: 'getFundamentals',
        tag: 'Fundamentals',
        params: [
          { name: 'ticker', in: 'path', type: 'string', required: true, description: 'Ticker symbol (case-insensitive, max 12 chars).' },
          { name: 'as_of', in: 'query', type: 'string', required: false, description: 'PIT date (YYYY-MM-DD). Rows visible iff filed_date <= as_of.', default: 'today' },
          { name: 'periods', in: 'query', type: 'integer', required: false, description: 'Quarterly rows returned (1–40).', default: '8' },
          { name: 'erp', in: 'query', type: 'number', required: false, description: 'Equity risk premium for the cost-of-capital layer (caller-supplied; never stored).', default: '0.05' },
          { name: 'tax_rate', in: 'query', type: 'number', required: false, description: 'Tax rate applied to the WACC debt shield.', default: '0.21' },
          { name: 'rf_tenor', in: 'query', type: 'string', required: false, description: 'Treasury CMT tenor backing rf_rate (3m|1y|2y|5y|10y|30y). Default 10y, the valuation convention; pair a short tenor with a bill-basis ERP.', default: '10y' },
        ],
        responses: [
          { status: 200, description: 'PIT quarterly rows + disclosures block.' },
          { status: 400, description: 'Malformed ticker or query parameter.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 402, description: 'Insufficient balance.' },
          { status: 404, description: 'Ticker not present in the fundamentals panel.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
    ],
  },
  {
    name: 'Utility',
    description: 'Ticker search, health, and service discovery.',
    endpoints: [
      {
        path: '/tickers',
        method: 'get',
        summary: 'Ticker universe search',
        description: 'List tickers in the universe or search by name/symbol. Free endpoint (no charge).',
        operationId: 'getTickers',
        tag: 'Utility',
        params: [
          { name: 'search', in: 'query', type: 'string', required: false, description: 'Search string.' },
          { name: 'mag7', in: 'query', type: 'boolean', required: false, description: 'Return only MAG7 tickers.' },
          { name: 'include_metadata', in: 'query', type: 'boolean', required: false, description: 'Include sector/ETF per ticker.' },
        ],
        responses: [{ status: 200, description: 'Ticker list or search results.' }],
      },
      {
        path: '/health',
        method: 'get',
        summary: 'Service health check',
        description: 'Returns current service status, version, and capability availability. Free, no auth required.',
        operationId: 'getHealth',
        tag: 'Utility',
        params: [],
        responses: [{ status: 200, description: 'Service is up.' }],
      },
    ],
  },
  {
    name: 'Account',
    description: 'Balance, billing, and invoice management.',
    endpoints: [
      {
        path: '/balance',
        method: 'get',
        summary: 'Account balance and rate limits',
        description: 'Returns current prepaid balance, account status, and rate-limit settings for the authenticated token.',
        operationId: 'getBalance',
        tag: 'Account',
        params: [],
        responses: [
          { status: 200, description: 'Account balance and status.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
          { status: 429, description: 'Rate limit exceeded.' },
        ],
      },
      {
        path: '/invoices',
        method: 'get',
        summary: 'Invoice history and spend summary',
        description: 'Returns paginated invoice history and a summary of spend by period.',
        operationId: 'getInvoices',
        tag: 'Account',
        params: [],
        responses: [
          { status: 200, description: 'Invoice history.' },
          { status: 401, description: 'Missing or invalid Bearer token.' },
        ],
      },
    ],
  },
  {
    name: 'Authentication',
    description:
      'API key provisioning, and the OAuth 2.0 authorization-code flow used by MCP clients. There is no client_credentials grant — server-to-server callers use a Bearer API key directly.',
    endpoints: [
      {
        path: '/oauth/token',
        method: 'post',
        summary: 'Exchange an authorization code or refresh token',
        description:
          'OAuth 2.0 token endpoint. Supports authorization_code (PKCE S256, single-use codes) and refresh_token (rotating) only; client_credentials returns unsupported_grant_type. The access_token is an rm_user_* API key valid 1 hour, usable as Bearer against any endpoint here. Accepts form-encoded or JSON.',
        operationId: 'exchangeOAuthToken',
        tag: 'Authentication',
        params: [],
        requestBody: {
          contentType: 'application/x-www-form-urlencoded',
          example: JSON.stringify(
            {
              grant_type: 'authorization_code',
              code: '9f2c1d…',
              redirect_uri: 'https://example.com/callback',
              client_id: '3f8a1c2e-5b47-4d90-9e21-7c6b0a4d8f13',
              code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
            },
            null,
            2
          ),
        },
        responses: [
          { status: 200, description: 'Access token issued (rm_user_* key + rotating refresh token).' },
          { status: 400, description: 'invalid_request, invalid_grant, or unsupported_grant_type.' },
          { status: 429, description: 'Token rate limit exceeded (60/min per IP).' },
        ],
      },
      {
        path: '/oauth/register',
        method: 'post',
        summary: 'Register an OAuth client (RFC 7591)',
        description:
          'Dynamic client registration for MCP clients. Public clients only — no client_secret is issued; the grant is bound by PKCE. redirect_uris must be absolute; http:// only for loopback hosts. Limited to 30 registrations per IP per hour.',
        operationId: 'registerOAuthClient',
        tag: 'Authentication',
        params: [],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify(
            {
              client_name: 'My MCP Client',
              redirect_uris: ['https://example.com/callback'],
            },
            null,
            2
          ),
        },
        responses: [
          { status: 201, description: 'Client registered; returns client_id.' },
          { status: 400, description: 'invalid_client_metadata or invalid_redirect_uri.' },
          { status: 429, description: 'Registration rate limit exceeded.' },
        ],
      },
      {
        path: '/oauth/revoke',
        method: 'post',
        summary: 'Revoke an access or refresh token (RFC 7009)',
        description:
          'Revokes the presented rm_user_* access token or refresh token. Returns 200 even for unknown tokens, per RFC 7009.',
        operationId: 'revokeOAuthToken',
        tag: 'Authentication',
        params: [],
        requestBody: {
          contentType: 'application/x-www-form-urlencoded',
          example: JSON.stringify({ token: 'rm_user_live_abc123_xyz789' }, null, 2),
        },
        responses: [
          { status: 200, description: 'Token revoked (or was already invalid).' },
          { status: 400, description: 'invalid_request — token parameter missing.' },
          { status: 429, description: 'Revocation rate limit exceeded.' },
        ],
      },
      {
        path: '/auth/provision',
        method: 'post',
        summary: 'Provision API Key',
        description: 'Create a new API key for the authenticated user.',
        operationId: 'provisionApiKey',
        tag: 'Authentication',
        params: [],
        responses: [
          { status: 200, description: 'API key created.' },
          { status: 401, description: 'Authentication required.' },
        ],
      },
    ],
  },
  {
    name: 'Billing',
    description: 'Cost estimation and pricing.',
    endpoints: [
      {
        path: '/estimate',
        method: 'post',
        sidebarLabel: 'Cost Estimate',
        summary: 'Estimate request cost',
        description: 'Returns predicted cost before a request is made. Free to call, requires authentication.',
        operationId: 'estimateCost',
        tag: 'Billing',
        params: [],
        requestBody: {
          contentType: 'application/json',
          example: JSON.stringify({ endpoint: 'ticker-returns', params: { ticker: 'AAPL', years: 5 } }, null, 2),
        },
        responses: [
          { status: 200, description: 'Cost estimate.' },
          { status: 400, description: 'Unknown endpoint or invalid request.' },
          { status: 401, description: 'Authentication required.' },
        ],
      },
    ],
  },
];

export function getEndpointById(operationId: string): Endpoint | undefined {
  for (const group of ENDPOINT_GROUPS) {
    const found = group.endpoints.find((e) => e.operationId === operationId);
    if (found) return found;
  }
  return undefined;
}

export function getEndpointByPathAndMethod(path: string, method: HttpMethod): Endpoint | undefined {
  for (const group of ENDPOINT_GROUPS) {
    const found = group.endpoints.find((e) => e.path === path && e.method === method);
    if (found) return found;
  }
  return undefined;
}
