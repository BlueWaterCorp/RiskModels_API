/**
 * RiskModels MCP server factory — hosted-transport variant.
 *
 * Parallel to `mcp/src/server.ts` (the stdio binary). They register identical
 * tools; this copy accepts `apiKey` / `apiBase` directly because the hosted
 * Next.js route has already authenticated the request and passes the user's
 * credentials in. No env/CLI-config resolution.
 *
 * SOURCE OF TRUTH REMINDER: if you change tool schemas or handler logic,
 * mirror the edit to `mcp/src/server.ts` so the stdio binary stays in sync.
 * The lists (6 tools, 5 resources) must match exactly.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DATA_DIR = join(process.cwd(), "mcp", "data");

export type McpServerOptions = {
  /** User's RiskModels API key (already validated upstream by the route). */
  apiKey: string;
  /** API base URL (defaults to `https://riskmodels.app`). */
  apiBase?: string;
};

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
  opts: McpServerOptions,
  method: "GET" | "POST",
  path: string,
  init: { query?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; data: unknown; meter: MeterEnvelope; error?: string }> {
  const apiBase = (opts.apiBase || "https://riskmodels.app").replace(/\/$/, "");
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
        Authorization: `Bearer ${opts.apiKey}`,
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

/**
 * Build an MCP server ready to be connected to any transport.
 * Caller supplies authenticated user credentials via `opts`.
 */
export function createMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "riskmodels-api",
    version: "1.0.0",
  });

  // --- Resources ---

  server.registerResource(
    "manifest",
    "riskmodels:///manifest",
    {
      title: "RiskModels Agent Manifest",
      description: "Agent Protocol service discovery manifest",
      mimeType: "application/json",
    },
    async (uri) => {
      const apiBase = (opts.apiBase || "https://riskmodels.app").replace(/\/$/, "");
      try {
        const res = await fetch(`${apiBase}/.well-known/agent-manifest.json`);
        if (res.ok) {
          const json = await res.json();
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
          };
        }
      } catch {
        // fall through to static
      }
      const capabilities = loadJson<unknown[]>("capabilities.json");
      const payload = {
        service: { name: "RiskModels", version: "2.0.0-agent" },
        capabilities: capabilities || [],
      };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
      };
    }
  );

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

  const schemaPaths = (): string[] => loadJson<string[]>("schema-paths.json") || [];

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
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ info: { title: "RiskModels API" } }) }],
      };
    }
  );

  // --- Tools ---

  server.registerTool(
    "riskmodels_list_endpoints",
    {
      title: "List RiskModels API Endpoints",
      description: "List all public API capabilities (id, name, method, endpoint, short description)",
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
      inputSchema: {
        id: z.string().describe("Capability id (e.g. ticker-returns, risk-decomposition)"),
      },
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
      inputSchema: {
        path: z.string().describe("Schema path or filename"),
      },
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

  // --- Live data tools ---

  server.registerTool(
    "get_l3_decomposition",
    {
      title: "L3 Hierarchical Risk Decomposition",
      description:
        "Daily EOD hierarchical orthogonal decomposition for a single ticker: market → sector → subsector → residual. Returns parallel time-series arrays plus hedge ratios. Data freshness: daily after US market close.",
      inputSchema: {
        ticker: z.string().describe("Stock ticker symbol, e.g. NVDA, AAPL"),
        market_factor_etf: z.string().optional().default("SPY"),
        years: z.number().int().min(1).max(15).optional().default(1),
      },
    },
    async ({ ticker, market_factor_etf, years }) => {
      const { status, data, meter, error } = await apiCall(opts, "GET", "/l3-decomposition", {
        query: {
          ticker,
          market_factor_etf: market_factor_etf || "SPY",
          years: String(years ?? 1),
        },
      });
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (status >= 400) return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
      return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
    },
  );

  server.registerTool(
    "get_metrics",
    {
      title: "Latest Risk Metrics Snapshot",
      description:
        "Latest daily EOD risk metrics for a ticker: L1/L2/L3 hedge ratios (SPY, sector ETF, subsector ETF), explained-risk fractions, daily volatility, price close, market cap.",
      inputSchema: {
        ticker: z.string().describe("Stock ticker symbol, e.g. NVDA, AAPL"),
      },
    },
    async ({ ticker }) => {
      const { status, data, meter, error } = await apiCall(
        opts,
        "GET",
        `/metrics/${encodeURIComponent(ticker.toUpperCase())}`,
      );
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (status >= 400) return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
      return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
    },
  );

  server.registerTool(
    "get_portfolio_risk_snapshot",
    {
      title: "Portfolio Risk Snapshot",
      description:
        "Bundled portfolio risk report for up to 100 positions: variance decomposition, 23-day volatility, optional diversification analytics. Response is cached per-user per-portfolio for 1 hour.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string(),
              weight: z.number().positive(),
            }),
          )
          .min(1)
          .max(100),
        title: z.string().max(200).optional(),
        as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        include_diversification: z.boolean().optional().default(false),
        window_days: z.number().int().min(20).max(2000).optional().default(252),
      },
    },
    async ({ positions, title, as_of_date, include_diversification, window_days }) => {
      const body: Record<string, unknown> = { positions, format: "json" };
      if (title) body.title = title;
      if (as_of_date) body.as_of_date = as_of_date;
      if (include_diversification) body.include_diversification = include_diversification;
      if (window_days) body.window_days = window_days;
      const { status, data, meter, error } = await apiCall(opts, "POST", "/portfolio/risk-snapshot", { body });
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (status >= 400) return { content: [{ type: "text", text: JSON.stringify({ error: `API ${status}`, detail: data }) }] };
      return { content: [{ type: "text", text: wrapWithMeter(data, meter) }] };
    },
  );

  return server;
}
