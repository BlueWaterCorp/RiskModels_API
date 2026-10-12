/**
 * OpenAI tool surface for the hosted MCP server (`/api/mcp/openai`).
 *
 * The default surface (`/api/mcp/sse`) is the one listed in the Anthropic
 * directory and stays unchanged. The OpenAI surface reuses the same handlers
 * with these differences:
 *  - the generic GET reader (`riskmodels_call_endpoint`) is not registered;
 *  - a small set of explicit read-only tools covers the useful GET routes that
 *    the generic reader used to reach;
 *  - the Lstar tools are renamed to describe what they return (residual
 *    returns and the recommended hedge depth);
 *  - the catalog tools are renamed `riskmodels_docs_*` and say they return
 *    documentation only;
 *  - the server instructions and first-call prompt name only tools that exist
 *    on this surface.
 *
 * Hosted-only: lives outside lib/mcp/tools/ so the stdio package does not
 * compile it.
 */

import { z } from "zod";
import type { RiskModelsClient } from "@riskmodels/sdk";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  errorResult,
  textResult,
  type McpLikeServer,
} from "@/lib/mcp/tools/riskmodels-tools";

export type McpSurface = "default" | "openai";

export const OPENAI_MCP_PATH = "/api/mcp/openai";

/** Tools registered by the shared code that the OpenAI surface leaves out. */
export const OPENAI_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(["riskmodels_call_endpoint"]);

type ToolOverride = { name: string; title?: string; description?: string };

/**
 * Name/title/description overrides applied at registration on the OpenAI
 * surface. Handlers and input schemas are the shared ones.
 */
export const OPENAI_TOOL_OVERRIDES: Readonly<Record<string, ToolOverride>> = {
  riskmodels_get_return_attribution: {
    name: "riskmodels_get_return_attribution",
    description:
      "Daily return attribution for one stock (GET /returns-decomposition): each day's gross return split into additive market, sector and subsector factor returns and the residual (stock-specific) return. include_lstar adds the residual return series at each day's recommended hedge depth.",
  },
  riskmodels_get_lstar: {
    name: "riskmodels_get_residual_returns",
    title: "RiskModels Residual Returns and Recommended Hedge Depth",
    description:
      "Daily residual (stock-specific) returns for one stock, with the recommended hedge depth on each date (L1 market, L2 sector or L3 subsector) and the hedge ratios at that depth (GET /lstar). Without threshold the depth is the one the ERM3 model publishes; with threshold it is the simplest depth whose marginal explained risk exceeds the threshold. Inputs: ticker; years of history (1-15, default 1); optional market factor ETF and threshold. Read-only. $0.02 per request.",
  },
  riskmodels_batch_lstar: {
    name: "riskmodels_get_residual_returns_batch",
    title: "RiskModels Residual Returns and Recommended Hedge Depth (Batch)",
    description:
      "Daily residual (stock-specific) returns, recommended hedge depth (L1, L2 or L3) and the hedge ratios at that depth for 1-100 tickers in one request (POST /batch/lstar), using the same depth rule as the single-ticker residual-returns tool. The POST computes and returns data; it does not modify account data. Output as JSON, Parquet or CSV. $0.015 per ticker plus $0.0075 per extra year, minimum $0.03 per call.",
  },
  riskmodels_list_endpoints: {
    name: "riskmodels_docs_list_endpoints",
    title: "RiskModels API Documentation: Endpoint List",
    description:
      "Documentation only: lists the RiskModels REST catalog (capability id, HTTP method, path and a one-line description for each endpoint) from a static file. This tool does not call or execute any endpoint and returns no market data. Free. API reference: https://riskmodels.app/docs/api",
  },
  riskmodels_get_capability: {
    name: "riskmodels_docs_get_capability",
    title: "RiskModels API Documentation: Capability Details",
    description:
      "Documentation only: returns one REST capability's definition by id (parameters, pricing and examples) from a static file. This tool does not call or execute any endpoint and returns no market data. Free. API reference: https://riskmodels.app/docs/api",
  },
  riskmodels_get_schema: {
    name: "riskmodels_docs_get_schema",
    title: "RiskModels API Documentation: Response Schema",
    description:
      "Documentation only: returns the JSON response schema for one REST endpoint by schema filename (for example ticker-returns-v2.json) from a static file. This tool does not call or execute any endpoint and returns no market data. Free. API reference: https://riskmodels.app/docs/api",
  },
};

/**
 * Patch `server.registerTool` so shared registrations land under their OpenAI
 * names and excluded tools are skipped. Apply AFTER `withAnnotationTitles` so
 * the overridden title is the one copied into `annotations.title`.
 */
export function applyOpenAiSurface(server: { registerTool: (...a: any[]) => unknown }): void {
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (
    name: unknown,
    config: unknown,
    cb: unknown,
  ) => {
    const key = String(name);
    if (OPENAI_EXCLUDED_TOOLS.has(key)) return undefined;
    const o = OPENAI_TOOL_OVERRIDES[key];
    if (!o) return register(name, config, cb);
    const c = (config ?? {}) as Record<string, unknown>;
    return register(
      o.name,
      {
        ...c,
        ...(o.title ? { title: o.title } : {}),
        ...(o.description ? { description: o.description } : {}),
      },
      cb,
    );
  };
}

export const OPENAI_MCP_SERVER_INSTRUCTIONS = `RiskModels returns US-equity factor risk from the ERM3 model: market, sector, subsector and residual risk decomposition; residual (stock-specific) returns with the recommended hedge depth; ETF hedge ratios and hedge notionals; long-only and long/short portfolio exposure; cross-sectional rankings, peer groups and cohort statistics; 13F filer, mutual fund and ETF holdings; macro factor and sector ETF returns; and point-in-time quarterly fundamentals.

All data is end-of-day and historical. Every tool is read-only: tools do not forecast, do not place orders and do not modify account data. Tools that call billed REST endpoints charge the connected RiskModels account; each such tool's description states its price. The documentation tools (riskmodels_docs_list_endpoints, riskmodels_docs_get_capability, riskmodels_docs_get_schema) read a static catalog, do not call any endpoint and return no market data.

API reference: https://riskmodels.app/docs/api`;

export const OPENAI_FIRST_LIVE_PROMPT =
  'Call riskmodels_compare with tickers ["AAPL","NVDA"]. Then call riskmodels_decompose on AAPL and on NVDA. Quote residual explained-risk and the L3 hedge ratios from the tool results. Do not answer from training data.';

type Query = Record<string, string | number | boolean>;

function setIf(query: Query, key: string, value: string | number | boolean | undefined): void {
  if (value !== undefined) query[key] = value;
}

/**
 * Explicit read-only tools for GET routes that the default surface reaches
 * only through the generic reader. One tool per route, fixed input schema.
 */
export function registerOpenAiOnlyTools(sdk: Pick<RiskModelsClient, "call">, server: McpLikeServer): void {
  server.registerTool(
    "riskmodels_get_peers",
    {
      title: "RiskModels Peer Group",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Peer group of one stock (GET /peers): the stocks sharing its subsector ETF (or sector ETF), ordered by market cap, with each peer's market cap. Inputs: ticker; group_by subsector_etf (default) or sector_etf; limit (1-200, default 50). Read-only. $0.005 per request.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        group_by: z
          .enum(["subsector_etf", "sector_etf"])
          .optional()
          .describe("Peer grouping (default subsector_etf)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max peers (default 50, max 200)"),
      },
    },
    async ({ ticker, group_by, limit }) => {
      try {
        const query: Query = { ticker: ticker.trim().toUpperCase() };
        setIf(query, "group_by", group_by);
        setIf(query, "limit", limit);
        return textResult(await sdk.call("GET", "/peers", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_search_funds",
    {
      title: "RiskModels Mutual Fund Search",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Looks up US mutual funds by ticker or fund-name fragment, or by equity style box (GET /funds/search), and returns each match's bw_fund_id, ticker, name, style box, asset class and total assets. Read-only. Free.",
      inputSchema: {
        q: z.string().optional().describe('Ticker or fund-name fragment, e.g. "contrafund" or "FCNTX"'),
        equity_style_9box: z
          .string()
          .optional()
          .describe('Style box slug or name, e.g. "large-growth" or "Large Growth"'),
        primary: z.boolean().optional().describe("Share-class primaries only"),
        limit: z.number().int().min(1).max(500).optional().describe("Max results (default 50, max 500)"),
        include_inactive: z
          .boolean()
          .optional()
          .describe("Also return funds without a recent holdings report (default false)"),
        include_etfs: z.boolean().optional().describe("Include funds flagged as ETFs (default true)"),
      },
    },
    async ({ q, equity_style_9box, primary, limit, include_inactive, include_etfs }) => {
      try {
        const query: Query = {};
        setIf(query, "q", q);
        setIf(query, "equity_style_9box", equity_style_9box);
        setIf(query, "primary", primary);
        setIf(query, "limit", limit);
        setIf(query, "include_inactive", include_inactive);
        setIf(query, "include_etfs", include_etfs);
        return textResult(await sdk.call("GET", "/funds/search", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_fund_snapshot",
    {
      title: "RiskModels Mutual Fund Snapshot",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Snapshot of one mutual fund (GET /funds/snapshot/{bw_fund_id}): registry details, latest return decomposition and diagnostics, top 25 holdings, L1/L2/L3 ETF hedge ratios, a 12-month portfolio time series, and the fund's rank within its style box on each ranked metric. Input: bw_fund_id (BW-FUND-…). Read-only. $0.05 per request.",
      inputSchema: {
        bw_fund_id: z.string().min(1).describe("Fund id, e.g. BW-FUND-S000019457"),
      },
    },
    async ({ bw_fund_id }) => {
      try {
        return textResult(
          await sdk.call("GET", `/funds/snapshot/${encodeURIComponent(bw_fund_id.trim())}`),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_fund_holdings",
    {
      title: "RiskModels Mutual Fund Holdings",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Holdings of one mutual fund at its latest filed SEC N-PORT report (GET /funds/{bw_fund_id}/holdings), ranked by absolute market value, shorts as negative values. Each holding has ticker, market value and signed weight; the response adds long, short, net and gross totals and ticker coverage. Inputs: bw_fund_id (BW-FUND-…); limit (1-5000, default 25). Read-only. $0.02 per request.",
      inputSchema: {
        bw_fund_id: z.string().min(1).describe("Fund id, e.g. BW-FUND-S000019457"),
        limit: z.number().int().min(1).max(5000).optional().describe("Max holdings (default 25; 5000 returns the whole book)"),
      },
    },
    async ({ bw_fund_id, limit }) => {
      try {
        const query: Query = {};
        setIf(query, "limit", limit);
        return textResult(
          await sdk.call("GET", `/funds/${encodeURIComponent(bw_fund_id.trim())}/holdings`, { query }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_macro_factor_returns",
    {
      title: "RiskModels Macro Factor Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Daily total returns of macro factors over a date range (GET /macro-factors): inflation, term_spread, short_rates, credit, oil, gold, usd, volatility, bitcoin and vix_spot. Inputs: optional comma-separated factors (default all ten), start and end dates (YYYY-MM-DD; default the five years to today). Read-only. $0.005 per request.",
      inputSchema: {
        factors: z
          .string()
          .optional()
          .describe("Comma-separated factor keys, e.g. \"oil,gold,usd\" (default all)"),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (inclusive)"),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD (inclusive)"),
      },
    },
    async ({ factors, start, end }) => {
      try {
        const query: Query = {};
        setIf(query, "factors", factors);
        setIf(query, "start", start);
        setIf(query, "end", end);
        return textResult(await sdk.call("GET", "/macro-factors", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_sector_etf_returns",
    {
      title: "RiskModels Market and Sector ETF Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Closing price and trailing 1-day, 21-day, 63-day and 252-day total returns on one date for SPY and the 11 GICS sector SPDR ETFs (GET /etf/factor-returns). Inputs: sleeve market, sector or all (default all); optional comma-separated subset of those tickers; optional date YYYY-MM-DD (default latest). Read-only. $0.02 per request.",
      inputSchema: {
        sleeve: z.enum(["market", "sector", "all"]).optional().describe("market (SPY), sector (11 sector SPDRs) or all (default)"),
        tickers: z
          .string()
          .optional()
          .describe("Comma-separated subset: SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE"),
        teo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Observation date YYYY-MM-DD (default latest)"),
      },
    },
    async ({ sleeve, tickers, teo }) => {
      try {
        const query: Query = {};
        setIf(query, "sleeve", sleeve);
        setIf(query, "tickers", tickers);
        setIf(query, "teo", teo);
        return textResult(await sdk.call("GET", "/etf/factor-returns", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
