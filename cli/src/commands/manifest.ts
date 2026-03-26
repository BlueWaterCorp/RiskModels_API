import { Command } from "commander";
import chalk from "chalk";

/** Aligned with mcp/data/capabilities.json (subset). */
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
    description: "Latest hedge ratios, explained risk, and volatility for one ticker. GET /api/metrics/{ticker}",
    method: "GET",
    path: "/api/metrics/{ticker}",
    properties: {
      ticker: { type: "string", description: "Stock symbol, e.g. AAPL" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_batch_analyze",
    description: "Portfolio batch analysis: positions and hedge-style metrics. POST /api/batch/analyze",
    method: "POST",
    path: "/api/batch/analyze",
    properties: {
      positions: {
        type: "array",
        description: "Positions: { ticker, quantity, cost_basis }[]",
      },
      analysis_type: {
        type: "string",
        description: "Analysis flavor",
        enum: ["risk", "hedging", "correlation", "comprehensive"],
      },
    },
    required: ["positions"],
  },
  {
    name: "riskmodels_ticker_returns",
    description: "Historical returns with L3 hedge ratio series. GET /api/ticker-returns",
    method: "GET",
    path: "/api/ticker-returns",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      years: { type: "integer", description: "Years of history (1–15)" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_l3_decomposition",
    description: "L3 risk decomposition for one ticker. GET /api/l3-decomposition",
    method: "GET",
    path: "/api/l3-decomposition",
    properties: {
      ticker: { type: "string", description: "Stock symbol" },
      date: { type: "string", description: "YYYY-MM-DD or omit for latest" },
    },
    required: ["ticker"],
  },
  {
    name: "riskmodels_search_tickers",
    description: "Search tickers by symbol or name. GET /api/tickers",
    method: "GET",
    path: "/api/tickers",
    properties: {
      search: { type: "string", description: "Query string" },
      include_metadata: { type: "boolean", description: "Include company metadata" },
    },
    required: [],
  },
  {
    name: "riskmodels_health",
    description: "API health check (no auth). GET /api/health",
    method: "GET",
    path: "/api/health",
    properties: {},
    required: [],
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
      base.items = {
        type: "object",
        properties: {
          ticker: { type: "string" },
          quantity: { type: "number" },
          cost_basis: { type: "number" },
        },
        required: ["ticker", "quantity", "cost_basis"],
      };
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
    description: "RiskModels API tools (use Authorization: Bearer rm_agent_* against https://riskmodels.app)",
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
