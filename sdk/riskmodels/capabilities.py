"""Single source for client.discover() — JSON spec + Markdown render."""

from __future__ import annotations

import json
from typing import Any

SDK_VERSION = "0.3.0"

_RANKING_METRICS = [
    "mkt_cap",
    "gross_return",
    "sector_residual",
    "subsector_residual",
    "er_l1",
    "er_l2",
    "er_l3",
]
_RANKING_COHORTS = ["universe", "sector", "subsector"]
_RANKING_WINDOWS = ["1d", "21d", "63d", "252d"]

# Parameters use JSON-friendly keys (required: bool) for discover(format="json") / tool builders.
_SDK_METHODS: list[dict[str, Any]] = [
    {
        "name": "get_metrics",
        "aliases": ["get_risk"],
        "summary": "Latest V3 snapshot: hedge ratios, explained risk, vol.",
        "description": (
            "Fetch the latest ERM3 risk metrics for one ticker. Returns semantic column names "
            "(e.g. l3_market_hr). Prefer as_dataframe=True so the frame includes attrs (legend, cheatsheet)."
        ),
        "scopes": ["ticker-returns (OAuth)"],
        "parameters": [
            {
                "name": "ticker",
                "type": "string",
                "required": True,
                "description": "US equity symbol; may be alias-resolved (e.g. GOOGL→GOOG).",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "If True, return a one-row pandas.DataFrame with SDK attrs.",
            },
            {
                "name": "validate",
                "type": "string",
                "required": False,
                "enum": ["off", "warn", "error"],
                "description": "Override client default for ER sum / HR sign checks.",
            },
        ],
        "returns": {
            "type": "pandas.DataFrame | dict",
            "description": "Semantic metrics row; dict path omits DataFrame attrs.",
        },
    },
    {
        "name": "get_metrics_with_macro_correlation",
        "aliases": [],
        "summary": "One-row ERM3 metrics plus macro_corr_* (two HTTP calls).",
        "description": (
            "Calls get_metrics(as_dataframe=True) then get_factor_correlation_single(as_dataframe=True); "
            "concatenates columns and merges lineage. Use for post-close / agent snapshots. "
            "macro_corr_* are return correlations, not hedge notionals (see COMBINED_ERM3_MACRO_LEGEND)."
        ),
        "scopes": ["ticker-returns (OAuth)", "factor-correlation"],
        "parameters": [
            {"name": "ticker", "type": "string", "required": True, "description": "US equity symbol."},
            {
                "name": "factors",
                "type": "array",
                "required": False,
                "description": "Macro keys; default all six.",
            },
            {
                "name": "return_type",
                "type": "string",
                "required": False,
                "default": "l3_residual",
                "enum": ["gross", "l1", "l2", "l3_residual"],
                "description": "Stock return series for correlation vs macro (gross vs ERM3 residuals).",
            },
            {
                "name": "window_days",
                "type": "integer",
                "required": False,
                "default": 252,
                "description": "Trailing paired-day window for correlation (20–2000).",
            },
            {
                "name": "method",
                "type": "string",
                "required": False,
                "default": "pearson",
                "enum": ["pearson", "spearman"],
                "description": "Correlation estimator.",
            },
            {
                "name": "validate",
                "type": "string",
                "required": False,
                "enum": ["off", "warn", "error"],
                "description": "Passed through to get_metrics.",
            },
        ],
        "returns": {
            "type": "pandas.DataFrame",
            "description": "Single row: ERM3 fields + macro_corr_* + macro_* parameter columns.",
        },
    },
    {
        "name": "get_ticker_returns",
        "aliases": ["get_history", "get_returns_series"],
        "summary": "Daily returns + rolling L3 HR/ER columns.",
        "description": (
            "Time series of gross returns and rolling L3 hedge ratio / explained-risk columns "
            "with semantic names (l3_market_hr, …)."
        ),
        "scopes": ["ticker-returns"],
        "parameters": [
            {"name": "ticker", "type": "string", "required": True, "description": "Symbol."},
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History length (1–15).",
            },
            {
                "name": "limit",
                "type": "integer",
                "required": False,
                "description": "Optional max rows.",
            },
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "json",
                "enum": ["json", "parquet", "csv"],
                "description": "Response format.",
            },
            {
                "name": "nocache",
                "type": "boolean",
                "required": False,
                "description": "Bypass cache when supported.",
            },
            {
                "name": "validate",
                "type": "string",
                "required": False,
                "enum": ["off", "warn", "error"],
                "description": "Validation mode for last row.",
            },
        ],
        "returns": {"type": "pandas.DataFrame", "description": "Daily rows with SDK attrs."},
    },
    {
        "name": "get_returns",
        "aliases": [],
        "summary": "Daily gross returns only (single name).",
        "description": "Simpler return series without rolling hedge columns.",
        "scopes": ["ticker-returns"],
        "parameters": [
            {"name": "ticker", "type": "string", "required": True, "description": "Symbol."},
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History length.",
            },
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "json",
                "enum": ["json", "parquet", "csv"],
                "description": "json returns dict; parquet/csv returns DataFrame.",
            },
        ],
        "returns": {
            "type": "dict | pandas.DataFrame",
            "description": "JSON body or tabular export.",
        },
    },
    {
        "name": "get_etf_returns",
        "aliases": [],
        "summary": "Daily gross returns for an ETF symbol.",
        "description": "Same shape as get_returns for ETF tickers.",
        "scopes": ["ticker-returns"],
        "parameters": [
            {"name": "symbol", "type": "string", "required": True, "description": "ETF ticker."},
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History length.",
            },
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "json",
                "enum": ["json", "parquet", "csv"],
                "description": "json returns dict; parquet/csv returns DataFrame.",
            },
        ],
        "returns": {"type": "dict | pandas.DataFrame", "description": "JSON or tabular."},
    },
    {
        "name": "get_plaid_holdings",
        "aliases": [],
        "summary": "Plaid-synced brokerage holdings (GET /plaid/holdings).",
        "description": (
            "Returns holdings, accounts, securities, and summary for the authenticated user. "
            "Requires API key scope plaid:holdings when scopes are set. Use with link-token + "
            "exchange-public-token in the web app to connect accounts first."
        ),
        "scopes": ["plaid-holdings", "plaid:holdings"],
        "parameters": [
            {
                "name": "authorization",
                "type": "http_header",
                "required": True,
                "description": "Bearer token; API keys with explicit scopes need plaid:holdings (or *).",
            },
        ],
        "returns": {
            "type": "dict",
            "description": "holdings, accounts, securities, summary, _metadata, _agent.",
        },
    },
    {
        "name": "post_portfolio_risk_index",
        "aliases": [],
        "summary": "Portfolio L3 variance decomposition (POST /portfolio/risk-index).",
        "description": (
            "Weighted portfolio ER breakdown and optional time series. Empty ``positions`` returns "
            "HTTP 200 with ``status: 'syncing'`` when holdings are not loaded yet (e.g. Plaid sync)."
        ),
        "scopes": ["ticker-returns"],
        "parameters": [
            {
                "name": "positions",
                "type": "array",
                "required": True,
                "description": "List of {ticker, weight} dicts or (ticker, weight) tuples; may be empty for sync polling.",
            },
            {
                "name": "time_series",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "Include daily portfolio ER time series.",
            },
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History span when time_series is True (1–15).",
            },
        ],
        "returns": {
            "type": "dict",
            "description": "portfolio_risk_index, per_ticker, summary, _metadata; or status=syncing when positions empty.",
        },
    },
    {
        "name": "post_portfolio_risk_snapshot_pdf",
        "aliases": [],
        "summary": "Portfolio risk snapshot PDF (POST /portfolio/risk-snapshot, format=pdf).",
        "description": (
            "One-page PDF with L3 explained risk and hedge ratios. Returns ``(bytes, RiskLineage)``. "
            "Optional ``title`` (display name) and ``as_of_date`` (YYYY-MM-DD). "
            "For JSON, call the same route with ``format='json'`` via your HTTP client or use "
            "``post_portfolio_risk_index`` / ``analyze_portfolio`` for structured metrics. "
            "Premium/cached endpoint — see OpenAPI and portal pricing."
        ),
        "scopes": ["portfolio-risk-snapshot"],
        "parameters": [
            {
                "name": "positions",
                "type": "array",
                "required": True,
                "description": "Mapping ticker→weight, or list of {ticker, weight} dicts.",
            },
            {
                "name": "title",
                "type": "string",
                "required": False,
                "description": "Optional report title (use title, not name).",
            },
            {
                "name": "as_of_date",
                "type": "string",
                "required": False,
                "description": "Optional YYYY-MM-DD override.",
            },
        ],
        "returns": {
            "type": "tuple[bytes, RiskLineage]",
            "description": "Raw PDF bytes and response lineage.",
        },
    },
    {
        "name": "get_rankings",
        "aliases": [],
        "summary": "Cross-sectional rank grid for one ticker (GET /rankings/{ticker}).",
        "description": (
            "Analyzes where a security sits in its sector/universe percentile for risk and return. "
            "Returns one row per (metric, cohort, window) with rank_ordinal, cohort_size, "
            "rank_percentile (100=best). DataFrame includes ranking_key, attrs['riskmodels_rankings_headline'], "
            "and riskmodels_warnings when cohort_size < 10. Default as_dataframe=True."
        ),
        "scopes": ["rankings"],
        "parameters": [
            {"name": "ticker", "type": "string", "required": True, "description": "US equity symbol."},
            {
                "name": "metric",
                "type": "string",
                "required": False,
                "enum": _RANKING_METRICS,
                "description": "Optional filter; omit for full grid.",
            },
            {
                "name": "cohort",
                "type": "string",
                "required": False,
                "enum": _RANKING_COHORTS,
                "description": "universe | sector | subsector; optional filter.",
            },
            {
                "name": "window",
                "type": "string",
                "required": False,
                "enum": _RANKING_WINDOWS,
                "description": "Return window tag; optional filter.",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": True,
                "description": "If True, return pandas.DataFrame with SDK attrs (default).",
            },
        ],
        "returns": {
            "type": "pandas.DataFrame | dict",
            "description": "Long rankings table or raw JSON.",
        },
    },
    {
        "name": "get_top_rankings",
        "aliases": [],
        "summary": "Leaderboard: best rank_ordinal first at latest teo (GET /rankings/top).",
        "description": (
            "Requires metric, cohort, window. limit 1–100 (default 10). Rows include ticker, "
            "rank_ordinal, cohort_size, rank_percentile; metric/cohort/window/ranking_key are "
            "broadcast for small-cohort warnings. attrs include riskmodels_rankings_headline and "
            "riskmodels_rankings_query JSON."
        ),
        "scopes": ["rankings"],
        "parameters": [
            {
                "name": "metric",
                "type": "string",
                "required": True,
                "enum": _RANKING_METRICS,
                "description": "Ranking metric key.",
            },
            {
                "name": "cohort",
                "type": "string",
                "required": True,
                "enum": _RANKING_COHORTS,
                "description": "Peer cohort.",
            },
            {
                "name": "window",
                "type": "string",
                "required": True,
                "enum": _RANKING_WINDOWS,
                "description": "Trailing window tag.",
            },
            {
                "name": "limit",
                "type": "integer",
                "required": False,
                "default": 10,
                "description": "Max names (1–100).",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": True,
                "description": "If True, return pandas.DataFrame with SDK attrs.",
            },
        ],
        "returns": {"type": "pandas.DataFrame | dict", "description": "Leaderboard table or raw JSON."},
    },
    {
        "name": "filter_universe_by_ranking",
        "aliases": ["filter_universe"],
        "summary": "Top names by rank_percentile (client-side filter on get_top_rankings).",
        "description": (
            "Fetches up to min(limit, 100) rows from get_top_rankings (API cap), then keeps rows with "
            "rank_percentile >= min_percentile (default 90). attrs include riskmodels_filter_note."
        ),
        "scopes": ["rankings"],
        "parameters": [
            {
                "name": "metric",
                "type": "string",
                "required": True,
                "enum": _RANKING_METRICS,
                "description": "Ranking metric key.",
            },
            {
                "name": "cohort",
                "type": "string",
                "required": True,
                "enum": _RANKING_COHORTS,
                "description": "Peer cohort.",
            },
            {
                "name": "window",
                "type": "string",
                "required": True,
                "enum": _RANKING_WINDOWS,
                "description": "Trailing window tag.",
            },
            {
                "name": "min_percentile",
                "type": "number",
                "required": False,
                "default": 90.0,
                "description": "Minimum rank_percentile inclusive (100 = best).",
            },
            {
                "name": "limit",
                "type": "integer",
                "required": False,
                "default": 500,
                "description": "Desired fetch size; server returns at most 100 rows per call.",
            },
        ],
        "returns": {"type": "pandas.DataFrame", "description": "Filtered leaderboard subset."},
    },
    {
        "name": "get_l3_decomposition",
        "aliases": [],
        "summary": "L3 HR/ER time series (parallel arrays as DataFrame).",
        "description": "Full L3 factor decomposition over time for one ticker.",
        "scopes": ["risk-decomposition"],
        "parameters": [
            {"name": "ticker", "type": "string", "required": True, "description": "Symbol."},
            {
                "name": "market_factor_etf",
                "type": "string",
                "required": False,
                "description": "Optional market ETF override (e.g. SPY).",
            },
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "description": "History window in years. Omit to use the server default (1).",
            },
            {
                "name": "validate",
                "type": "string",
                "required": False,
                "enum": ["off", "warn", "error"],
                "description": "Validation on last row.",
            },
        ],
        "returns": {"type": "pandas.DataFrame", "description": "Columns l3_market_hr, l3_*_er, …"},
    },
    {
        "name": "get_factor_correlation",
        "aliases": [],
        "summary": "Correlation vs macro factors (POST /correlation).",
        "description": (
            "Measures exposure to macro-economic drivers like interest rates and volatility. "
            "Pearson/Spearman correlation between stock returns (gross or ERM3 residual) and daily "
            "macro factor returns (macro_factors table). Pass one ticker or a list for batch."
        ),
        "scopes": ["factor-correlation"],
        "parameters": [
            {
                "name": "ticker",
                "type": "string | array",
                "required": True,
                "description": "Symbol or list of symbols (batch).",
            },
            {
                "name": "factors",
                "type": "array",
                "required": False,
                "description": "bitcoin, gold, oil, dxy, vix, ust10y2y (default all six).",
            },
            {
                "name": "return_type",
                "type": "string",
                "required": False,
                "default": "l3_residual",
                "enum": ["gross", "l1", "l2", "l3_residual"],
                "description": "Stock return series vs macro (gross or ERM3 residual).",
            },
            {
                "name": "window_days",
                "type": "integer",
                "required": False,
                "default": 252,
                "description": "Trailing paired-day window (20–2000).",
            },
            {
                "name": "method",
                "type": "string",
                "required": False,
                "default": "pearson",
                "enum": ["pearson", "spearman"],
                "description": "Correlation estimator.",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "If True, one row per ticker (batch) or one row (single); SDK attrs + macro_corr_*.",
            },
        ],
        "returns": {
            "type": "dict | pandas.DataFrame",
            "description": "Raw JSON or DataFrame with flattened macro_corr_* columns.",
        },
    },
    {
        "name": "get_factor_correlation_single",
        "aliases": [],
        "summary": "Single-ticker correlation via GET (cache-friendly).",
        "description": (
            "Lightweight GET endpoint for single-ticker factor correlation. Preferred over "
            "get_factor_correlation() when analyzing one ticker at a time. Uses URL parameters "
            "and is more cache-friendly than the POST endpoint."
        ),
        "scopes": ["factor-correlation"],
        "parameters": [
            {
                "name": "ticker",
                "type": "string",
                "required": True,
                "description": "Symbol (e.g., 'AAPL', 'NVDA').",
            },
            {
                "name": "factors",
                "type": "array",
                "required": False,
                "description": "bitcoin, gold, oil, dxy, vix, ust10y2y (default all six).",
            },
            {
                "name": "return_type",
                "type": "string",
                "required": False,
                "default": "l3_residual",
                "enum": ["gross", "l1", "l2", "l3_residual"],
                "description": "Stock return series vs macro (gross or ERM3 residual).",
            },
            {
                "name": "window_days",
                "type": "integer",
                "required": False,
                "default": 252,
                "description": "Trailing paired-day window (20–2000).",
            },
            {
                "name": "method",
                "type": "string",
                "required": False,
                "default": "pearson",
                "enum": ["pearson", "spearman"],
                "description": "Correlation estimator.",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "If True, one-row DataFrame with macro_corr_* and combined ERM3+macro legend attrs.",
            },
        ],
        "returns": {
            "type": "dict | pandas.DataFrame",
            "description": "API JSON or one-row frame with macro_corr_* columns and SDK attrs.",
        },
    },
    {
        "name": "get_macro_factor_series",
        "aliases": [],
        "summary": "Raw macro factor daily returns (GET /macro-factors).",
        "description": (
            "Long-format rows from macro_factors (factor_key, teo, return_gross) without a stock ticker. "
            "Use for charts or offline checks; correlation vs equities uses get_factor_correlation / "
            "get_factor_correlation_single."
        ),
        "scopes": ["macro-factor-series"],
        "parameters": [
            {
                "name": "factors",
                "type": "array",
                "required": False,
                "description": "bitcoin, gold, oil, dxy, vix, ust10y2y (default all six).",
            },
            {
                "name": "start",
                "type": "string",
                "required": False,
                "description": "Inclusive YYYY-MM-DD (default: five calendar years before end).",
            },
            {
                "name": "end",
                "type": "string",
                "required": False,
                "description": "Inclusive YYYY-MM-DD (default: today UTC).",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "If True, return only series[] as a long DataFrame with attrs.",
            },
        ],
        "returns": {
            "type": "dict | pandas.DataFrame",
            "description": "Full API JSON or long DataFrame of macro factor rows.",
        },
    },
    {
        "name": "batch_analyze",
        "aliases": ["batch"],
        "summary": "Up to 100 tickers: returns, hedge_ratios, full_metrics.",
        "description": (
            "Batch endpoint with explicit metrics whitelist. Parquet/CSV returns a long table; "
            "wire l1/l2/l3 are renamed to l3_market_hr, l3_sector_hr, l3_subsector_hr in DataFrames."
        ),
        "scopes": ["batch-analysis"],
        "parameters": [
            {
                "name": "tickers",
                "type": "array",
                "items": {"type": "string"},
                "required": True,
                "description": "Up to 100 symbols.",
            },
            {
                "name": "metrics",
                "type": "array",
                "items": {"type": "string", "enum": ["returns", "hedge_ratios", "full_metrics", "l3_decomposition"]},
                "required": True,
                "description": "Requested payload blocks per ticker.",
            },
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History for returns / l3_decomposition.",
            },
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "json",
                "enum": ["json", "parquet", "csv"],
                "description": "json returns dict; tabular returns (DataFrame, lineage).",
            },
        ],
        "returns": {
            "type": "dict | tuple",
            "description": ("JSON BatchAnalyzeResponse, or (pandas.DataFrame, RiskLineage) for parquet/csv export."),
        },
    },
    {
        "name": "analyze_portfolio",
        "aliases": ["analyze"],
        "summary": "Weighted portfolio hedge ratios + optional returns panel.",
        "description": (
            "Client-side holdings-weighted means of scalar HRs from full_metrics. "
            "Optional returns_long / xarray panel when include_returns_panel=True."
        ),
        "scopes": ["batch-analysis"],
        "parameters": [
            {
                "name": "positions",
                "type": "object",
                "required": True,
                "description": "Map ticker → weight (normalized to sum 1).",
            },
            {
                "name": "metrics",
                "type": "array",
                "items": {"type": "string"},
                "required": False,
                "description": "Default full_metrics + hedge_ratios; add returns for panel.",
            },
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "Batch history window when returns requested.",
            },
            {
                "name": "validate",
                "type": "string",
                "required": False,
                "enum": ["off", "warn", "error"],
                "description": "Per-ticker validation mode.",
            },
            {
                "name": "include_returns_panel",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "If True, fetch returns and attach returns_long / xarray panel.",
            },
            {
                "name": "er_tolerance",
                "type": "number",
                "required": False,
                "description": "L3 ER sum tolerance (default from client).",
            },
        ],
        "returns": {"type": "PortfolioAnalysis", "description": "Dataclass with to_llm_context()."},
    },
    {
        "name": "get_dataset",
        "aliases": ["get_cube", "get_panel"],
        "summary": "xarray Dataset (ticker × date); requires [xarray] extra.",
        "description": "Batch returns as a multi-index cube for broadcasted portfolio math.",
        "scopes": ["batch-analysis"],
        "parameters": [
            {
                "name": "tickers",
                "type": "array",
                "items": {"type": "string"},
                "required": True,
                "description": "Universe slice (chunk if >100).",
            },
            {
                "name": "years",
                "type": "integer",
                "required": False,
                "default": 1,
                "description": "History window.",
            },
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "parquet",
                "enum": ["parquet", "csv"],
                "description": "Tabular batch only (not json).",
            },
        ],
        "returns": {"type": "xarray.Dataset", "description": "Needs pip install riskmodels-py[xarray]."},
    },
    {
        "name": "search_tickers",
        "aliases": [],
        "summary": "Universe search (often unauthenticated / free).",
        "description": "Search or filter tickers; DataFrame includes SDK attrs when as_dataframe=True.",
        "scopes": [],
        "parameters": [
            {
                "name": "search",
                "type": "string",
                "required": False,
                "description": "Substring search.",
            },
            {
                "name": "mag7",
                "type": "boolean",
                "required": False,
                "description": "MAG7 shortcut when supported.",
            },
            {
                "name": "include_metadata",
                "type": "boolean",
                "required": False,
                "description": "Include sector/ETF metadata when supported.",
            },
            {
                "name": "as_dataframe",
                "type": "boolean",
                "required": False,
                "default": True,
                "description": "Return pandas.DataFrame with attrs.",
            },
        ],
        "returns": {"type": "pandas.DataFrame | list", "description": "Symbols or rows."},
    },
    {
        "name": "discover",
        "aliases": [],
        "summary": "Capability digest for humans and tool-def generators.",
        "description": (
            "Emit Markdown or JSON describing methods, parameters, costs, limits, and snippets. "
            "Use format=json with Claude Desktop / MCP-style hosts to synthesize tool definitions."
        ),
        "scopes": [],
        "parameters": [
            {
                "name": "format",
                "type": "string",
                "required": False,
                "default": "markdown",
                "enum": ["markdown", "json"],
                "description": "json returns machine-readable spec (this document).",
            },
            {
                "name": "to_stdout",
                "type": "boolean",
                "required": False,
                "default": True,
                "description": "Print result to stdout.",
            },
            {
                "name": "live",
                "type": "boolean",
                "required": False,
                "default": False,
                "description": "Append live /tickers ping (may require auth).",
            },
        ],
        "returns": {"type": "string | dict", "description": "Markdown str or DISCOVER_SPEC dict."},
    },
]

DISCOVER_SPEC: dict[str, Any] = {
    "sdk_version": SDK_VERSION,
    "tool_definition_hints": (
        "For each entry in methods[], build a tool: use name (or an alias) as tool name, "
        "description as the tool description, and map parameters[] to JSON Schema "
        "properties (required[] from parameters where required=true). "
        "Returns describes the SDK return type for docstrings."
    ),
    "doc_links": {
        "api_base": "https://riskmodels.app/api",
        "methodology": "https://riskmodels.app/docs/methodology",
    },
    "auth": {
        "modes": [
            "Static API key: RISKMODELS_API_KEY → Bearer token (no refresh).",
            "OAuth2 client credentials: RISKMODELS_CLIENT_ID + RISKMODELS_CLIENT_SECRET; JWT ~15m refresh.",
        ],
        "default_oauth_scope": (
            "ticker-returns risk-decomposition batch-analysis factor-correlation macro-factor-series rankings"
        ),
    },
    "costs": {
        "metrics_per_request_usd": "~0.005",
        "ticker_returns_per_request_usd": "~0.005",
        "batch_analyze_per_position_usd": "~0.002 (min ~0.01/call)",
        "note": "See X-API-Cost-USD header and OpenAPI descriptions; cached responses may be free.",
    },
    "limits": {
        "batch_tickers_max": 100,
        "returns_years_max": 15,
        "batch_years_max": 15,
    },
    "methods": _SDK_METHODS,
    "snippets": {
        "metrics": "client.get_metrics('NVDA', as_dataframe=True)",
        "metrics_macro": (
            "client.get_metrics_with_macro_correlation('NVDA', factors=['bitcoin','vix'], return_type='l3_residual')"
        ),
        "plaid_holdings": "client.get_plaid_holdings()  # API key needs plaid:holdings scope when scopes are set",
        "portfolio_risk_index": "client.post_portfolio_risk_index([])  # empty → check body['status']=='syncing'",
        "portfolio_risk_snapshot_pdf": (
            "pdf_bytes, _ = client.post_portfolio_risk_snapshot_pdf([('NVDA', 0.5), ('AAPL', 0.5)])"
        ),
        "rankings_ticker": "client.get_rankings('NVDA', as_dataframe=True)",
        "rankings_top": (
            "client.get_top_rankings(metric='subsector_residual', cohort='subsector', window='252d', limit=10)"
        ),
        "rankings_filter": (
            "client.filter_universe_by_ranking(metric='er_l3', cohort='universe', window='252d', min_percentile=90)"
        ),
        "rankings_badge_shields": (
            "https://img.shields.io/endpoint?url=https://riskmodels.app/api/rankings/AAPL/badge"
        ),
        "github_ranking_png": (
            "scripts/generate_readme_assets.py  # writes assets/*.png from get_rankings + MAG7 POST /correlation"
        ),
        "portfolio": "client.analyze_portfolio({'NVDA': 0.4, 'AAPL': 0.6})",
        "xarray": "ds = client.get_dataset(['AAPL','MSFT'], years=5)  # pip install riskmodels-py[xarray]",
        "discover_json": 'spec = client.discover(format="json", to_stdout=False)',
    },
    "batch_returns_columns_note": (
        "Batch Parquet/CSV columns l1,l2,l3 are the three rolling L3 component HR series "
        "(market, sector, subsector), renamed in the SDK to l3_market_hr, l3_sector_hr, l3_subsector_hr."
    ),
}


def discover_markdown(spec: dict[str, Any] | None = None) -> str:
    s = spec or DISCOVER_SPEC
    lines: list[str] = [
        f"# RiskModels Python SDK ({s['sdk_version']})",
        "",
        "## Auth",
        *[f"- {x}" for x in s["auth"]["modes"]],
        f"- Default OAuth scope string: `{s['auth']['default_oauth_scope']}`",
        "",
        "## Costs (ballpark)",
    ]
    for k, v in s["costs"].items():
        lines.append(f"- **{k}**: {v}")
    lines.extend(["", "## Limits", json.dumps(s["limits"], indent=2)])
    if s.get("tool_definition_hints"):
        lines.extend(["", "## Tool definition hints", s["tool_definition_hints"]])
    lines.extend(["", "## Methods (canonical + aliases + parameters)"])
    for m in s["methods"]:
        al = ", ".join(m["aliases"]) if m["aliases"] else "—"
        sc = ", ".join(m.get("scopes") or []) or "—"
        lines.append(f"### `{m['name']}` (aliases: {al})")
        lines.append(m.get("description") or m.get("summary", ""))
        lines.append(f"  Scopes: {sc}")
        lines.append("  Parameters:")
        for p in m.get("parameters") or []:
            req = "required" if p.get("required") else "optional"
            dflt = f", default={p['default']!r}" if "default" in p else ""
            en = f", enum={p['enum']}" if p.get("enum") else ""
            lines.append(f"  - `{p['name']}` ({p.get('type', 'any')}, {req}{dflt}{en}): {p.get('description', '')}")
        ret = m.get("returns")
        if ret:
            lines.append(f"  Returns: **{ret.get('type', '')}** — {ret.get('description', '')}")
        lines.append("")
    lines.extend(["", "## Snippets"])
    for name, code in s["snippets"].items():
        lines.append(f"### {name}")
        lines.append(f"```python\n{code}\n```")
    lines.extend(
        [
            "",
            "## Column note",
            s["batch_returns_columns_note"],
            "",
            "## Links",
            json.dumps(s["doc_links"], indent=2),
        ]
    )
    return "\n".join(lines)
