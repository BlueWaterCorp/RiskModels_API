"""Single source for client.discover() — JSON spec + Markdown render."""

from __future__ import annotations

import json
from typing import Any

SDK_VERSION = "0.2.0"

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
            "description": (
                "JSON BatchAnalyzeResponse, or (pandas.DataFrame, RiskLineage) for parquet/csv export."
            ),
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
        "default_oauth_scope": "ticker-returns risk-decomposition batch-analysis",
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
            lines.append(
                f"  - `{p['name']}` ({p.get('type', 'any')}, {req}{dflt}{en}): {p.get('description', '')}"
            )
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
