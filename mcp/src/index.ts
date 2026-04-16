/**
 * RiskModels API MCP server.
 * Resources + discovery tools (unchanged) plus live data tools that wrap REST
 * endpoints using the user's API key resolved from env or the CLI config file.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const DEFAULT_API_BASE = "https://riskmodels.app";
const CLI_CONFIG_PATH = join(homedir(), ".config", "riskmodels", "config.json");

type CliConfig = { apiKey?: string; apiBaseUrl?: string };

function resolveCredentials(): { apiKey: string | null; apiBase: string } {
  const envKey = process.env.RISKMODELS_API_KEY;
  const envBase =
    process.env.RISKMODELS_API_BASE ||
    process.env.NEXT_PUBLIC_APP_URL ||
    undefined;

  let cfg: CliConfig = {};
  if (existsSync(CLI_CONFIG_PATH)) {
    try {
      cfg = JSON.parse(readFileSync(CLI_CONFIG_PATH, "utf-8")) as CliConfig;
    } catch {
      // ignore — corrupt config just falls through to env
    }
  }

  const apiKey = envKey || cfg.apiKey || null;
  const apiBase = (envBase || cfg.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  return { apiKey, apiBase };
}

type MeterEnvelope = {
  _cost_usd?: number;
  _balance_remaining_usd?: number;
  _monthly_spend_cap_usd?: number;
  _current_monthly_spend_usd?: number;
  _rate_limit_remaining?: number;
  _data_as_of?: string;
  _data_source?: string;
  _latency_ms?: number;
  _request_id?: string;
  _pricing_tier?: string;
};

const TOKEN_PRICE_USD = 0.00002;

function extractMeter(headers: Headers): MeterEnvelope {
  const parseNum = (h: string | null) => (h == null ? undefined : Number(h));
  const balanceTokens = parseNum(headers.get("X-Balance-Remaining"));
  const balanceUsd =
    balanceTokens !== undefined && !Number.isNaN(balanceTokens)
      ? +(balanceTokens * TOKEN_PRICE_USD).toFixed(4)
      : undefined;
  return {
    _cost_usd: parseNum(headers.get("X-API-Cost-USD")),
    _balance_remaining_usd: balanceUsd,
    _monthly_spend_cap_usd: parseNum(headers.get("X-Monthly-Spend-Cap-USD")),
    _current_monthly_spend_usd: parseNum(headers.get("X-Current-Monthly-Spend-USD")),
    _rate_limit_remaining: parseNum(headers.get("X-RateLimit-Remaining")),
    _data_as_of: headers.get("X-Data-As-Of") || undefined,
    _latency_ms: parseNum(headers.get("X-Data-Fetch-Latency-Ms")),
    _request_id: headers.get("X-Request-ID") || undefined,
    _pricing_tier: headers.get("X-Pricing-Tier") || undefined,
  };
}

async function apiCall(
  method: "GET" | "POST",
  path: string,
  init: { query?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; data: unknown; meter: MeterEnvelope; error?: string }> {
  const { apiKey, apiBase } = resolveCredentials();
  if (!apiKey) {
    return {
      status: 0,
      data: null,
      meter: {},
      error:
        "RiskModels API key not found. Set RISKMODELS_API_KEY in the MCP client env, or run `riskmodels config init` to store it at ~/.config/riskmodels/config.json.",
    };
  }
  const url = new URL(`${apiBase}/api${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const meter = extractMeter(res.headers);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = { error: "Non-JSON response", status: res.status };
    }
    return { status: res.status, data, meter };
  } catch (e) {
    return {
      status: 0,
      data: null,
      meter: {},
      error: `Network error calling RiskModels API: ${(e as Error).message}`,
    };
  }
}

function wrapWithMeter(data: unknown, meter: MeterEnvelope): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const metaFromBody = record._metadata as
      | { data_as_of?: string; data_source?: string }
      | undefined;
    const envelope: MeterEnvelope = {
      ...meter,
      _data_as_of: meter._data_as_of || metaFromBody?.data_as_of,
      _data_source: metaFromBody?.data_source,
    };
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(envelope)) {
      if (v !== undefined && v !== null && !Number.isNaN(v as number)) {
        clean[k] = v;
      }
    }
    return JSON.stringify({ ...record, ...clean }, null, 2);
  }
  return JSON.stringify({ data, ...meter }, null, 2);
}

function loadJson<T>(relativePath: string): T | null {
  const p = join(DATA_DIR, relativePath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadText(relativePath: string): string | null {
  const p = join(DATA_DIR, relativePath);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

const server = new McpServer({
  name: "riskmodels-api",
  version: "1.0.0",
});

// --- Resources ---

// riskmodels:///manifest — agent manifest (fetch from API if base URL set, else static)
server.registerResource(
  "manifest",
  "riskmodels:///manifest",
  {
    title: "RiskModels Agent Manifest",
    description: "Agent Protocol service discovery manifest (from API when base URL set)",
    mimeType: "application/json",
  },
  async (uri) => {
    const baseUrl = process.env.RISKMODELS_API_BASE || process.env.NEXT_PUBLIC_APP_URL;
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/agent-manifest.json`);
        if (res.ok) {
          const json = await res.json();
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
          };
        }
      } catch {
        // fall through to static
      }
    }
    const capabilities = loadJson<unknown[]>("capabilities.json");
    const payload = {
      service: { name: "RiskModels", version: "2.0.0-agent" },
      capabilities: capabilities || [],
      _note: "Set RISKMODELS_API_BASE or NEXT_PUBLIC_APP_URL to fetch live manifest.",
    };
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

// riskmodels:///capabilities — list of API capabilities
server.registerResource(
  "capabilities",
  "riskmodels:///capabilities",
  {
    title: "RiskModels API Capabilities",
    description: "List of API capabilities with endpoints, parameters, pricing",
    mimeType: "application/json",
  },
  async (uri) => {
    const data = loadJson<unknown>("capabilities.json");
    const text = data ? JSON.stringify(data, null, 2) : JSON.stringify({ error: "capabilities.json not found" });
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text }],
    };
  }
);

// riskmodels:///schemas/list — list of schema paths
server.registerResource(
  "schemas-list",
  "riskmodels:///schemas/list",
  {
    title: "RiskModels Schema Paths",
    description: "List of available response schema paths",
    mimeType: "application/json",
  },
  async (uri) => {
    const data = loadJson<string[]>("schema-paths.json");
    const text = data ? JSON.stringify(data, null, 2) : JSON.stringify([]);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text }],
    };
  }
);

// riskmodels:///schemas/{path} — individual schema
const schemaPaths = (): string[] => {
  const list = loadJson<string[]>("schema-paths.json");
  return list || [];
};

server.registerResource(
  "schema-by-path",
  new ResourceTemplate("riskmodels:///schemas/{path}", {
    list: async () => ({
      resources: schemaPaths().map((p) => ({
        uri: `riskmodels:///schemas/${encodeURIComponent(p.replace(/^\/schemas\//, ""))}`,
        name: p.split("/").pop() || p,
      })),
    }),
  }),
  {
    title: "RiskModels Response Schema",
    description: "JSON schema for an API response by path (e.g. ticker-returns-v2.json)",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const pathVar = variables.path;
    const pathSeg = typeof pathVar === "string" ? pathVar : Array.isArray(pathVar) ? pathVar[0] : "";
    const normalized = pathSeg.startsWith("/schemas/") ? pathSeg : `/schemas/${pathSeg}`;
    const filename = normalized.split("/").pop() || pathSeg;
    const data = loadJson<unknown>(join("schemas", filename));
    const text = data ? JSON.stringify(data, null, 2) : JSON.stringify({ error: `Schema not found: ${pathSeg}` });
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text }],
    };
  }
);

// riskmodels:///openapi — OpenAPI spec if present
server.registerResource(
  "openapi",
  "riskmodels:///openapi",
  {
    title: "RiskModels OpenAPI Spec",
    description: "OpenAPI 3.x specification for the API",
    mimeType: "application/json",
  },
  async (uri) => {
    const yaml = loadText("openapi.yaml");
    const json = loadJson<unknown>("openapi.json");
    if (json) {
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
      };
    }
    if (yaml) {
      return {
        contents: [{ uri: uri.href, mimeType: "application/yaml", text: yaml }],
      };
    }
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ info: { title: "RiskModels API" }, _note: "Add openapi.json or openapi.yaml to mcp/data/" }) }],
    };
  }
);

// --- Tools ---

server.registerTool(
  "riskmodels_list_endpoints",
  {
    title: "List RiskModels API Endpoints",
    description: "List all public API capabilities (id, name, method, endpoint, short description)",
    inputSchema: z.object({}).optional(),
  },
  async () => {
    const capabilities = loadJson<Array<{ id: string; name: string; method: string; endpoint: string; description: string }>>("capabilities.json");
    if (!capabilities) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "capabilities.json not found" }) }] };
    }
    const list = capabilities.map((c) => ({
      id: c.id,
      name: c.name,
      method: c.method,
      endpoint: c.endpoint,
      description: (c.description || "").slice(0, 80),
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.registerTool(
  "riskmodels_get_capability",
  {
    title: "Get RiskModels Capability Details",
    description: "Get full capability details (parameters, pricing, examples) by id",
    inputSchema: z.object({
      id: z.string().describe("Capability id (e.g. ticker-returns, risk-decomposition)"),
    }),
  },
  async ({ id }) => {
    const capabilities = loadJson<Array<{ id: string; [k: string]: unknown }>>("capabilities.json");
    if (!capabilities) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Capabilities not loaded" }) }] };
    }
    const cap = capabilities.find((c) => c.id === id);
    if (!cap) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown capability: ${id}`, available: capabilities.map((c) => c.id) }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(cap, null, 2) }] };
  }
);

server.registerTool(
  "riskmodels_get_schema",
  {
    title: "Get RiskModels Response Schema",
    description: "Get JSON schema for an API response by path (e.g. ticker-returns-v2.json)",
    inputSchema: z.object({
      path: z.string().describe("Schema path or filename (e.g. ticker-returns-v2.json or /schemas/ticker-returns-v2.json)"),
    }),
  },
  async ({ path: pathArg }) => {
    const pathSeg = pathArg.replace(/^\/schemas\//, "");
    const filename = pathSeg.endsWith(".json") ? pathSeg : `${pathSeg}.json`;
    const data = loadJson<unknown>(join("schemas", filename));
    if (!data) {
      const paths = loadJson<string[]>("schema-paths.json") || [];
      return { content: [{ type: "text", text: JSON.stringify({ error: `Schema not found: ${filename}`, available: paths }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Live data tools (require API key via env or ~/.config/riskmodels/config.json) ---

server.registerTool(
  "get_l3_decomposition",
  {
    title: "L3 Hierarchical Risk Decomposition",
    description:
      "Daily EOD hierarchical orthogonal decomposition for a single ticker: market → sector → subsector → residual. Returns parallel time-series arrays plus hedge ratios. Historical data from GCP zarr; latest snapshot from Supabase. Data freshness: daily after US market close (see _data_as_of).",
    inputSchema: z.object({
      ticker: z.string().describe("Stock ticker symbol, e.g. NVDA, AAPL"),
      market_factor_etf: z
        .string()
        .optional()
        .default("SPY")
        .describe("Market factor ETF for L1 (default SPY)"),
      years: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .default(1)
        .describe("Years of daily history to return (1–15)"),
    }),
  },
  async ({ ticker, market_factor_etf, years }) => {
    const { status, data, meter, error } = await apiCall("GET", "/l3-decomposition", {
      query: {
        ticker,
        market_factor_etf: market_factor_etf || "SPY",
        years: String(years ?? 1),
      },
    });
    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
    }
    if (status >= 400) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
    }
    return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
  },
);

server.registerTool(
  "get_metrics",
  {
    title: "Latest Risk Metrics Snapshot",
    description:
      "Latest daily EOD risk metrics for a ticker from the Supabase _latest table: L1/L2/L3 hedge ratios (SPY, sector ETF, subsector ETF), explained-risk fractions, daily volatility, price close, market cap. Single-row snapshot. Data freshness: daily after US market close.",
    inputSchema: z.object({
      ticker: z.string().describe("Stock ticker symbol, e.g. NVDA, AAPL"),
    }),
  },
  async ({ ticker }) => {
    const { status, data, meter, error } = await apiCall(
      "GET",
      `/metrics/${encodeURIComponent(ticker.toUpperCase())}`,
    );
    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
    }
    if (status >= 400) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
    }
    return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
  },
);

server.registerTool(
  "get_portfolio_risk_snapshot",
  {
    title: "Portfolio Risk Snapshot",
    description:
      "Bundled portfolio risk report for up to 100 positions: variance decomposition (market / sector / subsector / residual / systematic), portfolio 23-day volatility, and optional diversification analytics with sector/subsector ETF correlation matrices. Returns JSON by default. Response is cached per-user per-portfolio for 1 hour.",
    inputSchema: z.object({
      positions: z
        .array(
          z.object({
            ticker: z.string(),
            weight: z.number().positive(),
          }),
        )
        .min(1)
        .max(100)
        .describe("Positions as { ticker, weight } pairs. Weights need not sum to 1."),
      title: z.string().max(200).optional(),
      as_of_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("YYYY-MM-DD override for the snapshot date"),
      include_diversification: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include diversification metrics (adds latency)"),
      window_days: z
        .number()
        .int()
        .min(20)
        .max(2000)
        .optional()
        .default(252)
        .describe("Rolling window in trading days for diversification"),
    }),
  },
  async ({ positions, title, as_of_date, include_diversification, window_days }) => {
    const body: Record<string, unknown> = { positions, format: "json" };
    if (title) body.title = title;
    if (as_of_date) body.as_of_date = as_of_date;
    if (include_diversification) body.include_diversification = include_diversification;
    if (window_days) body.window_days = window_days;
    const { status, data, meter, error } = await apiCall("POST", "/portfolio/risk-snapshot", { body });
    if (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
    }
    if (status >= 400) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
    }
    return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
  },
);

// --- Start stdio transport ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
