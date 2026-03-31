import { Command } from "commander";
import chalk from "chalk";

/** Aligned with OpenAPI paths under /api (see OPENAPI_SPEC.yaml). */
const TOOLS: Array<{
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  properties: Record<
    string,
    { type: "string" | "integer" | "boolean" | "array"; description: string; enum?: string[] }
  >;
  required: string[];
}> = [
  {
    name: "riskmodels_cli_query",
    description:
      "Execute read-only SQL SELECT against RiskModels data (billed). POST /api/cli/query with Bearer token.",
    method: "POST",
    path: "/api/cli/query",
    properties: {
      sql: { type: "string", description: "SELECT query (single statement, no semicolons)" },
      limit: { type: "integer", description: "Max rows if SQL omits LIMIT (1–10000)" },
    },
    required: ["sql"],
  },
  {
    name: "riskmodels_get_metrics",
    description: "Latest V3 hedge ratios, explained risk, volatility. GET /api/metrics/{ticker}",
    method: "GET",
    path: "/api/metrics/{ticker}",
    properties: {
      ticker: { type: "string", description: "Stock symbol, e.g. AAPL" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_batch_analyze",
    description: "Multi-ticker batch: returns, hedge_ratios, full_metrics, l3_decomposition. POST /api/batch/analyze",
    method: "POST",
    path: "/api/batch/analyze",
    properties: {
      tickers: {
        type: "array",
        description: "Up to 100 ticker strings",
      },
      metrics: {
        type: "array",
        description: "Whitelist: returns, l3_decomposition, hedge_ratios, full_metrics",
      },
      years: { type: "integer", description: "1–15 for returns / l3_decomposition" },
      format: { type: "string", description: "json | parquet | csv", enum: ["json", "parquet", "csv"] },
    },
    required: ["tickers", "metrics"],
  },
  {
    name: "riskmodels_portfolio_risk_index",
    description: "Holdings-weighted L3 portfolio decomposition. POST /api/portfolio/risk-index",
    method: "POST",
    path: "/api/portfolio/risk-index",
    properties: {
      positions: {
        type: "array",
        description: "{ ticker, weight }[] — weights normalized server-side",
      },
      timeSeries: { type: "boolean", description: "Include daily portfolio ER time series" },
      years: { type: "integer", description: "History when timeSeries is true" },
    },
    required: ["positions"],
  },
  {
    name: "riskmodels_ticker_returns",
    description: "Daily returns with L3 hedge ratio columns. GET /api/ticker-returns",
    method: "GET",
    path: "/api/ticker-returns",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      years: { type: "integer", description: "Years of history (1–15)" },
      format: { type: "string", description: "json | parquet | csv", enum: ["json", "parquet", "csv"] },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_returns_simple",
    description: "Daily gross returns (single ticker). GET /api/returns",
    method: "GET",
    path: "/api/returns",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_etf_returns",
    description: "Daily ETF gross returns. GET /api/etf-returns",
    method: "GET",
    path: "/api/etf-returns",
    properties: {
      etf: { type: "string", description: "ETF symbol, e.g. SPY" },
    },
    required: ["etf"],
  },
  {
    name: "riskmodels_l3_decomposition",
    description: "L3 HR/ER time series. GET /api/l3-decomposition",
    method: "GET",
    path: "/api/l3-decomposition",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      market_factor_etf: { type: "string", description: "Default SPY" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_factor_correlation",
    description: "Macro factor correlation (batch or single). POST /api/correlation",
    method: "POST",
    path: "/api/correlation",
    properties: {
      ticker: { type: "string", description: "One ticker or use array in wire JSON for batch" },
      factors: { type: "array", description: "Macro factor keys" },
      return_type: {
        type: "string",
        description: "gross | l1 | l2 | l3_residual",
        enum: ["gross", "l1", "l2", "l3_residual"],
      },
      window_days: { type: "integer", description: "20–2000" },
      method: { type: "string", description: "pearson | spearman", enum: ["pearson", "spearman"] },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_factor_correlation_by_ticker",
    description: "GET convenience for macro correlations. GET /api/metrics/{ticker}/correlation",
    method: "GET",
    path: "/api/metrics/{ticker}/correlation",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      factors: { type: "string", description: "Comma-separated factor keys" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_rankings_snapshot",
    description: "Cross-sectional ranks for one ticker. GET /api/rankings/{ticker}",
    method: "GET",
    path: "/api/rankings/{ticker}",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      metric: { type: "string", description: "Optional filter" },
      cohort: { type: "string", description: "universe | sector | subsector" },
      window: { type: "string", description: "1d | 21d | 63d | 252d" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_rankings_top",
    description: "Leaderboard. GET /api/rankings/top",
    method: "GET",
    path: "/api/rankings/top",
    properties: {
      metric: { type: "string", description: "Required" },
      cohort: { type: "string", description: "universe | sector | subsector" },
      window: { type: "string", description: "1d | 21d | 63d | 252d" },
      limit: { type: "integer", description: "1–100" },
    },
    required: ["metric", "cohort", "window"],
  },
  {
    name: "riskmodels_search_tickers",
    description: "Universe search (no auth). GET /api/tickers",
    method: "GET",
    path: "/api/tickers",
    properties: {
      search: { type: "string", description: "Symbol or name" },
      mag7: { type: "boolean", description: "MAG7 only" },
      include_metadata: { type: "boolean", description: "Sector / ETF metadata" },
    },
    required: [],
  },
  {
    name: "riskmodels_health",
    description: "Service health (no auth). GET /api/health",
    method: "GET",
    path: "/api/health",
    properties: {},
    required: [],
  },
  {
    name: "riskmodels_estimate",
    description: "Pre-flight cost estimate. POST /api/estimate",
    method: "POST",
    path: "/api/estimate",
    properties: {
      endpoint: { type: "string", description: "Endpoint slug, e.g. ticker-returns" },
      params: { type: "string", description: "JSON object string with same params as the target endpoint" },
    },
    required: ["endpoint"],
  },
];

function inputSchema(tool: (typeof TOOLS)[number]) {
  const properties: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(tool.properties)) {
    const base: Record<string, unknown> = {
      description: spec.description,
      ...(spec.enum ? { enum: spec.enum } : {}),
    };
    if (spec.type === "integer") {
      base.type = "integer";
    } else if (spec.type === "array") {
      base.type = "array";
      base.items = { type: "string" };
    } else {
      base.type = spec.type;
    }
    properties[key] = base;
  }
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (tool.required.length) {
    schema.required = tool.required;
  }
  return schema;
}

function anthropicManifest() {
  return {
    manifest_version: "1.0",
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: `${t.description} Base URL: https://riskmodels.app`,
      input_schema: inputSchema(t),
    })),
  };
}

function openaiManifest() {
  return {
    tools: TOOLS.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: `${t.description} Base URL: https://riskmodels.app`,
        parameters: inputSchema(t),
      },
    })),
  };
}

/** Zed-oriented bundle: tool list + JSON Schema parameters (no auth embedded). */
function zedManifest() {
  return {
    schema_version: 1,
    name: "riskmodels",
    description: "RiskModels API tools (use Authorization: Bearer rm_agent_* or OAuth against https://riskmodels.app/api)",
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      method: t.method,
      path: t.path,
      parameters: inputSchema(t),
    })),
  };
}

export function manifestCommand(): Command {
  return new Command("manifest")
    .description("Print static agent tool manifest (no API credentials required)")
    .option("-f, --format <name>", "openai | anthropic | zed", "anthropic")
    .action((opts: { format?: string }) => {
      const fmt = (opts.format ?? "anthropic").toLowerCase();
      let out: unknown;
      if (fmt === "openai") {
        out = openaiManifest();
      } else if (fmt === "anthropic") {
        out = anthropicManifest();
      } else if (fmt === "zed") {
        out = zedManifest();
      } else {
        console.error(chalk.red(`Unknown format: ${fmt}. Use openai, anthropic, or zed.`));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(out, null, 2));
    });
}
