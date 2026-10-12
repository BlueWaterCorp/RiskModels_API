import { readFileSync } from "fs";
import { join } from "path";
import { RiskModelsClient, type PositionInput, type WhitepaperExampleId } from "@riskmodels/sdk";
import { z } from "zod";
import { EMPTY_BOOK_MESSAGE, fetchLinkedBook } from "./linked-book.js";

type McpContent = { type: "text"; text: string };
type McpImageContent = { type: "image"; data: string; mimeType: "image/png" };
type McpTextResult = { content: McpContent[] };
export type McpToolResult = {
  content: Array<McpContent | McpImageContent>;
  isError?: boolean;
  /** Passed to MCP Apps; not shown to the model. */
  _meta?: Record<string, unknown>;
};
type McpPromptResult = {
  description?: string;
  messages: Array<{ role: "user" | "assistant"; content: McpContent }>;
};

export type McpLikeServer = {
  registerTool: (name: string, config: Record<string, unknown>, handler: (args: any) => Promise<McpToolResult>) => void;
  registerResource: (
    name: string,
    uri: string,
    config: Record<string, unknown>,
    handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }> }>,
  ) => void;
  registerPrompt?: (
    name: string,
    config: Record<string, unknown>,
    handler: (args: any) => McpPromptResult | Promise<McpPromptResult>,
  ) => void;
};

const WHITEPAPER_RESOURCES = [
  {
    name: "whitepaper-one-position-four-bets",
    uri: "riskmodels://whitepaper/one-position-four-bets",
    title: "One Position, Four Bets",
    file: "one-position-four-bets.md",
  },
  {
    name: "whitepaper-core-claim",
    uri: "riskmodels://whitepaper/chapter/01-core-claim",
    title: "Core Claim",
    file: "01-core-claim.md",
  },
  {
    name: "whitepaper-aapl-vs-nvda",
    uri: "riskmodels://whitepaper/chapter/02-aapl-vs-nvda",
    title: "AAPL vs NVDA",
    file: "02-aapl-vs-nvda.md",
  },
  {
    name: "whitepaper-hedging",
    uri: "riskmodels://whitepaper/chapter/03-hedging",
    title: "Hedging",
    file: "03-hedging.md",
  },
  {
    name: "example-aapl-nvda-crwd",
    uri: "riskmodels://examples/aapl-nvda-crwd",
    title: "AAPL, NVDA, CRWD Example",
    file: "examples-aapl-nvda-crwd.md",
  },
] as const;

export function textResult(payload: unknown): McpTextResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { data: payload },
          null,
          2,
        ),
      },
    ],
  };
}

/** A failed tool call: the payload carries `error` and the result is flagged `isError`. */
export function toolErrorResult(payload: { error: string } & Record<string, unknown>): McpToolResult {
  return { ...textResult(payload), isError: true };
}

export function errorResult(error: unknown): McpToolResult {
  return toolErrorResult({ error: error instanceof Error ? error.message : String(error) });
}

/**
 * Benchmarks `riskmodels_get_benchmark_fit` accepts: the `live` entries of
 * lib/benchmark-registry.ts plus `all`. The static SPY / 70/30 surfaces are
 * `development` (writer staleness) and answer 409, so they are not offered.
 * tests/mcp-directory-compliance.test.ts keeps this list in step with the registry.
 */
export const LIVE_FIT_BENCHMARKS = [
  "ff_own",
  "cell_large-value",
  "cell_large-blend",
  "cell_large-growth",
  "cell_small-value",
  "cell_small-blend",
  "cell_small-growth",
  "all",
] as const;

function readWhitepaperFile(dataDir: string, file: string): string {
  return readFileSync(join(dataDir, "whitepaper", file), "utf-8");
}

function promptText(text: string): McpPromptResult {
  return {
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

/**
 * MCP tool annotations for every RiskModels tool. All tools only read model
 * data (POST routes compute, they do not persist), none modify or delete
 * user data, and all reach the live RiskModels API (open world). Emitted as
 * explicit booleans because directory reviews (OpenAI, Anthropic) reject
 * omitted hints.
 */
export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

/**
 * Copy each tool's `title` into `annotations.title`, the field the MCP
 * directory reads for the listing name. Must run before any registerTool.
 */
export function withAnnotationTitles(server: { registerTool: (...a: any[]) => unknown }): void {
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: (...a: unknown[]) => unknown }).registerTool = (
    name: unknown,
    config: unknown,
    cb: unknown,
  ) => {
    const c = (config ?? {}) as { title?: string; annotations?: Record<string, unknown> };
    const annotations = c.title ? { title: c.title, ...(c.annotations ?? {}) } : c.annotations;
    return register(name, { ...c, annotations }, cb);
  };
}

export function createRiskModelsSdk(opts: { apiKey?: string | null; apiBase?: string }): RiskModelsClient {
  const base = (opts.apiBase || "https://riskmodels.app").replace(/\/$/, "");
  return new RiskModelsClient({
    apiKey: opts.apiKey ?? undefined,
    baseUrl: base.endsWith("/api") ? base : `${base}/api`,
  });
}

/** Capabilities/paths the generic passthrough must never reach (SQL, Plaid, chat). */
const PASSTHROUGH_BLOCKED = [/^\/cli(\/|$)/i, /^\/plaid(\/|$)/i, /^\/chat(\/|$)/i];

/**
 * Normalize a passthrough path BEFORE any allow/deny decision: decode, drop a
 * query string, strip a leading `/api`, and resolve `.`/`..` segments. Resolving
 * traversal here is what stops `/x/../cli/query` from reaching a blocked endpoint
 * after URL normalization downstream.
 */
export function normalizeApiPath(raw: string): string {
  let p = (raw ?? "").trim();
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep undecoded */
  }
  const qi = p.indexOf("?");
  if (qi >= 0) p = p.slice(0, qi);
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/^\/api(?=\/|$)/, "");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

function endpointToMatcher(method: string, endpoint: string): { method: string; re: RegExp } {
  const path = endpoint.replace(/^\/api(?=\/|$)/, "");
  const parts = path
    .split("/")
    .map((seg) => (/^\{.+\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return { method: method.toUpperCase(), re: new RegExp(`^${parts.join("/")}$`) };
}

/**
 * Allowlist of path patterns the generic reader may GET: registered,
 * non-blocked GET capabilities only. POST analytics have purpose-built tools.
 */
export function buildPassthroughAllowlist(
  capabilities: Array<{ method?: string; endpoint?: string }>,
): Array<{ method: string; re: RegExp }> {
  return capabilities
    .filter((c) => typeof c.method === "string" && typeof c.endpoint === "string")
    .filter((c) => (c.method as string).toUpperCase() === "GET")
    .map((c) => ({ method: c.method as string, path: (c.endpoint as string).replace(/^\/api(?=\/|$)/, "") }))
    .filter((c) => !PASSTHROUGH_BLOCKED.some((re) => re.test(c.path)))
    .map((c) => endpointToMatcher(c.method, c.path));
}

export function registerRiskModelsTools(
  sdk: Pick<
    RiskModelsClient,
    | "decompose"
    | "getHedgeLevels"
    | "compare"
    | "hedgePosition"
    | "analyzePortfolio"
    | "hedgePortfolio"
    | "portfolioDecompose"
    | "whitepaperExample"
    | "getReturns"
    | "getReturnAttribution"
    | "call"
  >,
  server: McpLikeServer,
  opts: {
    capabilities?: Array<{ method?: string; endpoint?: string; [k: string]: unknown }>;
    /** Caller's RiskModels API key. The linked-book tool forwards it to riskmodels.net. */
    apiKey?: string | null;
    /** Override https://riskmodels.net for tests. */
    portalBase?: string;
    fetchPositions?: typeof fetch;
  } = {},
): void {
  const passthroughAllowlist = buildPassthroughAllowlist(opts.capabilities ?? []);

  server.registerTool(
    "riskmodels_decompose",
    {
      title: "RiskModels Single-Stock Decomposition",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Decomposes one US stock's risk into additive market, sector, subsector and residual layers at L3 (POST /decompose): explained-risk share, hedge ratio and hedge ETF for each layer, with chart-ready data and a plain-English summary. Input: ticker.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
      },
    },
    async ({ ticker }) => {
      try {
        return textResult(await sdk.decompose(ticker));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_returns",
    {
      title: "RiskModels Stock Total Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Daily dividend-adjusted total return series for one US stock or ETF (GET /ticker-returns), with each day's L3 market, sector and subsector hedge ratios and explained-risk shares. Inputs: ticker; years of history (1-15, default 1). History is point-in-time.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
        years: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("Years of daily history (default 1, max 15)"),
      },
    },
    async ({ ticker, years }) => {
      try {
        return textResult(await sdk.getReturns(ticker, { years }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_return_attribution",
    {
      title: "RiskModels Return Attribution (factor vs residual)",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Daily return attribution for one stock (GET /returns-decomposition): each day's gross return split into additive market, sector and subsector factor returns and the residual (stock-specific) return. include_lstar adds the residual series at each day's Lstar level.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
        years: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Calendar years of daily history (default 1)"),
        market_factor_etf: z.string().optional().describe("Market factor ETF (default SPY)"),
        include_lstar: z
          .boolean()
          .optional()
          .describe("Include lstar + lstar_residual_return arrays (default false)"),
        threshold: z
          .number()
          .optional()
          .describe("Marginal ER threshold for Lstar derivation (default 0.01)"),
      },
    },
    async ({ ticker, years, market_factor_etf, include_lstar, threshold }) => {
      try {
        return textResult(
          await sdk.getReturnAttribution(ticker, {
            years,
            marketFactorEtf: market_factor_etf,
            includeLstar: include_lstar,
            threshold,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_lstar",
    {
      title: "RiskModels Lstar Recommended Hedge Level",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Recommended hedge depth (L1, L2 or L3) for one stock by date (GET /lstar), with the hedge ratios at that depth and the daily residual return series. Without threshold the level is the one ERM3 publishes; with threshold it is the simplest level whose marginal explained risk exceeds the threshold. $0.02 per request.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
        years: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("Calendar years of daily history (default 1, max 15)"),
        market_factor_etf: z.string().optional().describe("Market factor ETF (default SPY)"),
        axis: z
          .enum(["industry"])
          .optional()
          .describe(
            "Cascade axis: industry only. The style axis was removed in v4 and returns 400.",
          ),
        threshold: z
          .number()
          .optional()
          .describe("Marginal ER threshold for level selection (default 0.01)"),
      },
    },
    async ({ ticker, years, market_factor_etf, axis, threshold }) => {
      try {
        const query: Record<string, string | number | boolean> = {
          ticker: ticker.trim().toUpperCase(),
        };
        if (years !== undefined) query.years = years;
        if (market_factor_etf !== undefined) query.market_factor_etf = market_factor_etf;
        if (axis !== undefined) query.axis = axis;
        if (threshold !== undefined) query.threshold = threshold;
        return textResult(await sdk.call("GET", "/lstar", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_batch_lstar",
    {
      title: "RiskModels Batch Lstar Residual Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Lstar levels, hedge ratios and daily residual returns for 1-100 tickers in one request (POST /batch/lstar), using the same level rule as GET /lstar. Output as JSON, Parquet or CSV. $0.015 per ticker plus $0.0075 per extra year, minimum $0.03 per call.",
      inputSchema: {
        tickers: z.array(z.string().min(1)).min(1).max(100).describe("Ticker symbols (1-100)"),
        years: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("Calendar years of daily history (default 1)"),
        market_factor_etf: z.string().optional().describe("Market factor ETF (default SPY)"),
        threshold: z
          .number()
          .optional()
          .describe("Optional marginal ER threshold; omit for the canonical ERM3 level (an explicit value applies the legacy rule)"),
        format: z
          .enum(["json", "parquet", "csv"])
          .optional()
          .describe("Response format (default json)"),
      },
    },
    async ({ tickers, years, market_factor_etf, threshold, format }) => {
      try {
        const body: Record<string, unknown> = {
          tickers: tickers.map((t: string) => t.trim().toUpperCase()),
        };
        if (years !== undefined) body.years = years;
        if (market_factor_etf !== undefined) body.market_factor_etf = market_factor_etf;
        if (threshold !== undefined) body.threshold = threshold;
        if (format !== undefined) body.format = format;
        return textResult(await sdk.call("POST", "/batch/lstar", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_hedge_levels",
    {
      title: "RiskModels L1/L2/L3 hedge_levels",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "L1, L2 and L3 hedge snapshots for one stock (GET /metrics/{ticker}): hedge ratios, explained-risk shares and hedge ETFs at each depth. Input: ticker.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA or AAPL"),
      },
    },
    async ({ ticker }) => {
      try {
        return textResult(await sdk.getHedgeLevels(ticker));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_compare",
    {
      title: "RiskModels Multi-Ticker Comparison",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Compares 2-100 tickers across market, sector, subsector and residual risk layers: explained-risk shares and hedge ratios for each ticker, with chart-ready data.",
      inputSchema: {
        tickers: z.array(z.string().min(1)).min(2).max(100).describe("Ticker symbols to compare"),
      },
    },
    async ({ tickers }) => {
      try {
        return textResult(await sdk.compare(tickers));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_hedge_position",
    {
      title: "RiskModels Position Hedge",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "ETF hedge notionals for a dollar position in one stock: the stock's hedge ratios at each level scaled to the dollar amount. Inputs: ticker, dollars.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        dollars: z.number().positive().describe("Dollar notional of the stock position"),
      },
    },
    async ({ ticker, dollars }) => {
      try {
        return textResult(await sdk.hedgePosition({ ticker, dollars }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_my_positions",
    {
      title: "RiskModels linked brokerage positions",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Reads the caller's linked brokerage positions (Alpaca Connect, Connect Trade or Plaid) from their default riskmodels.net portfolio: ticker, quantity, market value and weight of each position, has_shorts, and the same book in three shapes: for_analysis (positive weights), for_hedge (positive dollar values) and for_exposure (signed dollars, short < 0). Read-only; it does not place orders. Returns an empty book when no brokerage is linked. No inputs.",
      inputSchema: {},
    },
    async () => {
      if (!opts.apiKey) {
        return toolErrorResult({
          error:
            "RiskModels API key not found. Set RISKMODELS_API_KEY in the MCP client env, or connect the hosted server with a key.",
        });
      }
      try {
        const result = await fetchLinkedBook(opts.apiKey, {
          portalBase: opts.portalBase,
          fetchImpl: opts.fetchPositions,
        });
        if (!result.ok) return toolErrorResult({ error: result.error, status: result.status });
        if (result.book.empty) {
          return textResult({ ...result.book, message: EMPTY_BOOK_MESSAGE });
        }
        return textResult(result.book);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_analyze_portfolio",
    {
      title: "RiskModels Portfolio hedge_levels aggregate",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Holdings-weighted L1, L2 and L3 hedge levels for a long-only book of up to 100 names (POST /batch/analyze), with per-ticker detail. Positions: ticker with a positive weight or dollar amount; short positions are not accepted.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              weight: z.number().positive().optional(),
              dollars: z.number().positive().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe("Positions with weight or dollars (combined per ticker)"),
        years: z.number().int().min(1).max(30).optional().describe("Batch lookback window, default 1"),
      },
    },
    async ({ positions, years }) => {
      try {
        return textResult(await sdk.analyzePortfolio(positions as PositionInput[], { years }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_hedge_portfolio",
    {
      title: "RiskModels Portfolio ETF hedge notionals",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "ETF hedge notionals for a long-only book of up to 100 names: each name's hedge ratios at the chosen level (L1, L2 or L3; default L3) scaled by its dollar value and summed by ETF. Dollar values must be positive.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              dollars: z.number().positive(),
            }),
          )
          .min(1)
          .max(100),
        level: z.enum(["L1", "L2", "L3"]).optional().describe("Cascade depth; default L3"),
        years: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ positions, level, years }) => {
      try {
        return textResult(
          await sdk.hedgePortfolio(
            positions.map((row: { ticker: string; dollars: number }) => ({
              ticker: row.ticker,
              dollars: row.dollars,
            })),
            {
            level,
            years,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_portfolio_exposure",
    {
      title: "RiskModels Long/Short Portfolio Exposure",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Exposure of a signed long/short book of 1-1000 positions (POST /portfolio/exposure). Positions are { ticker, value } in signed dollars (short < 0), netted by security and not rescaled. Returns beta-dollars by sector, the ETF trades that neutralise the book at L1, L2 and L3, systematic and residual dollar risk at hedge_level (default lstar: each name at its own L* level), coverage (positions not modelled, with reasons) and warnings. $0.25 per call up to 25 modelled names, $1.00 above.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              value: z
                .number()
                .finite()
                .refine((v) => v !== 0, "value must be non-zero (signed dollars; short < 0)")
                .describe("Signed dollar market value; short < 0"),
            }),
          )
          .min(1)
          .max(1000)
          .describe("Signed book: { ticker, value } in dollars, short < 0 (1-1000)"),
        hedge_level: z
          .enum(["lstar", "l1", "l2", "l3"])
          .optional()
          .describe("lstar (default): each name at its own L* level. l1/l2/l3: one level for every name"),
        lookback_days: z
          .number()
          .int()
          .min(60)
          .max(756)
          .optional()
          .describe("Trading days in the ETF covariance window (default 252)"),
        as_of: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Past model date YYYY-MM-DD (2011-12-07 or later; before 2013-01-01 lstar uses L3); omit for the latest"),
      },
    },
    async ({ positions, hedge_level, lookback_days, as_of }) => {
      try {
        const body: Record<string, unknown> = {
          positions: positions.map((row: { ticker: string; value: number }) => ({
            ticker: row.ticker.trim().toUpperCase(),
            value: row.value,
          })),
        };
        if (hedge_level !== undefined) body.hedge_level = hedge_level;
        if (lookback_days !== undefined) body.lookback_days = lookback_days;
        if (as_of !== undefined) body.as_of = as_of;
        return textResult(await sdk.call("POST", "/portfolio/exposure", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_portfolio_decompose",
    {
      title: "RiskModels Portfolio Decomposition",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Risk decomposition of a long-only weighted portfolio of up to 100 names into market, sector, subsector and residual layers. Positions: ticker with a positive weight or dollar amount.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              weight: z.number().positive().optional(),
              dollars: z.number().positive().optional(),
            }),
          )
          .min(1)
          .max(100)
          .describe("Portfolio positions as ticker plus weight or dollars"),
      },
    },
    async ({ positions }) => {
      try {
        return textResult(await sdk.portfolioDecompose(positions as PositionInput[]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_whitepaper_example",
    {
      title: "RiskModels Live White-Paper Example",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Runs one of four fixed examples from the RiskModels white paper on live data (aapl-vs-nvda, aapl-nvda-crwd, nvda-10000-hedge, portfolio-decomposition) and returns the chapter text with the live results.",
      inputSchema: {
        exampleId: z
          .enum(["aapl-vs-nvda", "aapl-nvda-crwd", "nvda-10000-hedge", "portfolio-decomposition"])
          .describe("White-paper example id"),
      },
    },
    async ({ exampleId }) => {
      try {
        return textResult(await sdk.whitepaperExample(exampleId as WhitepaperExampleId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- Entity resolution (free discovery) ---

  server.registerTool(
    "riskmodels_search_tickers",
    {
      title: "RiskModels Ticker Search",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Looks up RiskModels tickers by symbol or company-name fragment (GET /tickers). mag7=true returns the seven largest US technology names. Free.",
      inputSchema: {
        search: z.string().optional().describe('Symbol or company-name fragment, e.g. "nvidia" or "NVDA"'),
        mag7: z.boolean().optional().describe("Return the MAG7 set"),
        include_metadata: z.boolean().optional().describe("Include extra metadata per match"),
      },
    },
    async ({ search, mag7, include_metadata }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (search !== undefined) query.search = search;
        if (mag7 !== undefined) query.mag7 = mag7;
        if (include_metadata !== undefined) query.include_metadata = include_metadata;
        return textResult(await sdk.call("GET", "/tickers", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_search_filers",
    {
      title: "RiskModels 13F Filer Search",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Looks up 13F filers by name fragment (GET /13f/filers/search) and returns each match's bw_filer_id. Free.",
      inputSchema: {
        q: z.string().min(1).describe("Filer name fragment, e.g. \"berkshire\""),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
      },
    },
    async ({ q, limit }) => {
      try {
        const query: Record<string, string | number | boolean> = { q };
        if (limit !== undefined) query.limit = limit;
        return textResult(await sdk.call("GET", "/13f/filers/search", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_search_etfs",
    {
      title: "RiskModels ETF Search",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Looks up ETFs in the RiskModels universe by symbol or name fragment (GET /data/etf/search). Free.",
      inputSchema: {
        q: z.string().optional().describe("Symbol or name fragment, e.g. \"semiconductor\" or \"SMH\""),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
      },
    },
    async ({ q, limit }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (q !== undefined) query.q = q;
        if (limit !== undefined) query.limit = limit;
        return textResult(await sdk.call("GET", "/data/etf/search", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- Cross-sectional / peer analytics ---

  server.registerTool(
    "riskmodels_get_rankings",
    {
      title: "RiskModels Cross-Sectional Rankings",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "One stock's percentile rank within its universe, sector or subsector cohort for a metric and window (GET /rankings/{ticker}). Metrics: subsector_residual, sector_residual, gross_return, mkt_cap, er_l1, er_l2, er_l3. Windows: 1d, 21d, 63d, 252d.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        metric: z
          .string()
          .optional()
          .describe("subsector_residual, sector_residual, gross_return, mkt_cap, er_l1, er_l2 or er_l3"),
        cohort: z.string().optional().describe("universe, sector or subsector"),
        window: z.string().optional().describe("1d, 21d, 63d or 252d"),
      },
    },
    async ({ ticker, metric, cohort, window }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (metric !== undefined) query.metric = metric;
        if (cohort !== undefined) query.cohort = cohort;
        if (window !== undefined) query.window = window;
        return textResult(
          await sdk.call("GET", `/rankings/${encodeURIComponent(ticker.trim().toUpperCase())}`, { query }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_cohorts",
    {
      title: "RiskModels Cohort Statistics",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Cross-sectional residual statistics for SPY and the 11 GICS sector SPDR cohorts: one date (GET /cohorts) or a date range when series=true (GET /cohorts/series). Default variables: residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective; more on request. ERM3 residuals are fitted without an intercept, so residual_mean is not zero. link_fit_resid_sd is the residual standard deviation of the 252-day link regression, a fit-quality measure rather than a standard error. Subsector cohorts are not available.",
      inputSchema: {
        cohorts: z
          .string()
          .optional()
          .describe("Comma-separated cohort tickers (SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE). Default: all"),
        variables: z
          .string()
          .optional()
          .describe("Comma-separated variables. Default: residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective"),
        series: z
          .boolean()
          .optional()
          .describe("If true, return a time series over start_date..end_date instead of a one-date cross-section"),
        teo: z.string().optional().describe("Observation date YYYY-MM-DD for the cross-section (default latest)"),
        start_date: z.string().optional().describe("Series window start YYYY-MM-DD (series=true only)"),
        end_date: z.string().optional().describe("Series window end YYYY-MM-DD (series=true only)"),
        min_names: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Drop cohorts/days below this member count — their statistics are noise"),
      },
    },
    async ({ cohorts, variables, series, teo, start_date, end_date, min_names }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (cohorts !== undefined) query.cohorts = cohorts;
        if (variables !== undefined) query.variables = variables;
        if (min_names !== undefined) query.min_names = min_names;
        if (series) {
          if (start_date !== undefined) query.start_date = start_date;
          if (end_date !== undefined) query.end_date = end_date;
          return textResult(await sdk.call("GET", "/cohorts/series", { query }));
        }
        if (teo !== undefined) query.teo = teo;
        return textResult(await sdk.call("GET", "/cohorts", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_decompose_selection_vs_drift",
    {
      title: "RiskModels Selection vs Drift",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Splits a book's realized residual return over a date window into selection (from holding names that beat their cohort's average residual) and drift (from net exposure to the cohort average) (POST /cohorts/pnl-decomposition). The two sum exactly to the total. Weights are held constant over the window and are not normalized; a short is a negative weight. Positions that cannot be mapped to a cohort are listed in coverage.dropped. Historical attribution only.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1),
              weight: z.number().describe("Portfolio weight; negative for a short"),
            }),
          )
          .min(1)
          .max(500)
          .describe("The book to attribute"),
        level: z
          .enum(["market", "sector"])
          .optional()
          .describe("Cascade level (default sector)"),
        start_date: z.string().optional().describe("Window start YYYY-MM-DD"),
        end_date: z.string().optional().describe("Window end YYYY-MM-DD"),
        min_names: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Ignore cohort means on days the cohort was thinner than this"),
        include_series: z
          .boolean()
          .optional()
          .describe("Include the daily selection/drift series (bulky)"),
      },
    },
    async ({ positions, level, start_date, end_date, min_names, include_series }) => {
      try {
        const body: Record<string, unknown> = { positions };
        if (level !== undefined) body.level = level;
        if (start_date !== undefined) body.start_date = start_date;
        if (end_date !== undefined) body.end_date = end_date;
        if (min_names !== undefined) body.min_names = min_names;
        if (include_series !== undefined) body.include_series = include_series;
        return textResult(await sdk.call("POST", "/cohorts/pnl-decomposition", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_fundamentals",
    {
      title: "RiskModels PIT Quarterly Fundamentals",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Point-in-time quarterly fundamentals for one stock (GET /fundamentals/{ticker}): TTM profitability and capital-return ratios, leverage, ERM3 valuation betas, cost_of_debt and wacc from reported data, separately labelled cost_of_debt_imputed and wacc_imputed from a market proxy (10-year Treasury plus a high-quality corporate spread, not issuer-specific), economic profit, an equity-bridge decomposition and SEC line items (sec_facts). A quarter is included only if it was filed on or before as_of. grid=true adds an ERP x Treasury-tenor table of cost of equity, wacc, wacc_imputed and economic profit for the latest period. Historical data only.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. AAPL"),
        as_of: z.string().optional().describe("Point-in-time date YYYY-MM-DD (default: today)"),
        periods: z.number().int().min(1).max(40).optional().describe("Quarterly rows returned, most recent last (default 8, max 40)"),
        erp: z.number().min(0).max(0.5).optional().describe("Equity risk premium request parameter for cost-of-capital (default 0.05 when omitted)"),
        tax_rate: z.number().min(0).max(1).optional().describe("Tax rate applied to the WACC debt shield (default 0.21)"),
        rf_tenor: z
          .enum(["3m", "1y", "2y", "5y", "10y", "30y"])
          .optional()
          .describe("Treasury CMT tenor backing rf_rate (default 10y — pair a short tenor with a bill-basis ERP)"),
        grid: z
          .boolean()
          .optional()
          .describe("If true, response also carries sensitivity_grid: cost_of_equity, strict wacc, parallel wacc_imputed, and economic_profit across erp_grid x rf_tenor_grid for the latest PIT-visible period only"),
        erp_grid: z.string().optional().describe('Comma-separated ERP values for the grid, e.g. "0.03,0.04,0.05,0.06,0.07". Only used when grid=true'),
        rf_tenor_grid: z.string().optional().describe('Comma-separated tenor subset for the grid, e.g. "1y,10y,30y". Only used when grid=true'),
      },
    },
    async ({ ticker, as_of, periods, erp, tax_rate, rf_tenor, grid, erp_grid, rf_tenor_grid }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (as_of !== undefined) query.as_of = as_of;
        if (periods !== undefined) query.periods = periods;
        if (erp !== undefined) query.erp = erp;
        if (tax_rate !== undefined) query.tax_rate = tax_rate;
        if (rf_tenor !== undefined) query.rf_tenor = rf_tenor;
        if (grid !== undefined) query.grid = grid;
        if (erp_grid !== undefined) query.erp_grid = erp_grid;
        if (rf_tenor_grid !== undefined) query.rf_tenor_grid = rf_tenor_grid;
        return textResult(
          await sdk.call("GET", `/fundamentals/${encodeURIComponent(ticker.trim().toUpperCase())}`, { query }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_screen_rankings",
    {
      title: "RiskModels Rankings Screen",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Ranks the full universe for one metric, cohort and window (POST /rankings/screen) and returns the names that pass optional percentile, decile and sector filters. Metrics, cohorts and windows are the same as GET /rankings/{ticker}.",
      inputSchema: {
        metric: z
          .string()
          .min(1)
          .describe("subsector_residual, sector_residual, gross_return, mkt_cap, er_l1, er_l2 or er_l3"),
        cohort: z.string().min(1).describe("universe, sector or subsector"),
        window: z.string().min(1).describe("1d, 21d, 63d or 252d"),
        as_of: z.string().optional().describe("As-of date (YYYY-MM-DD)"),
        min_percentile: z.number().optional().describe("Minimum percentile filter"),
        decile: z.number().int().optional().describe("Restrict to a decile (1-10)"),
        sector_filter: z.string().optional().describe("Restrict to a sector"),
        limit: z.number().int().optional().describe("Max rows (default 100)"),
      },
    },
    async ({ metric, cohort, window, as_of, min_percentile, decile, sector_filter, limit }) => {
      try {
        const body: Record<string, unknown> = { metric, cohort, window };
        if (as_of !== undefined) body.as_of = as_of;
        if (min_percentile !== undefined) body.min_percentile = min_percentile;
        if (decile !== undefined) body.decile = decile;
        if (sector_filter !== undefined) body.sector_filter = sector_filter;
        if (limit !== undefined) body.limit = limit;
        return textResult(await sdk.call("POST", "/rankings/screen", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_macro_correlation",
    {
      title: "RiskModels Macro Factor Correlation",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Correlation of one stock's returns with macro factors such as rates and volatility (POST /correlation), Pearson or Spearman over a rolling window. Uses the L3 residual return by default.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        factors: z.array(z.string()).optional().describe("Macro factor ids to test (default: standard set)"),
        return_type: z.string().optional().describe('Return series to correlate (default "l3_residual")'),
        window_days: z.number().int().optional().describe("Rolling window in days (default 252)"),
        method: z.string().optional().describe('"pearson" (default) or "spearman"'),
      },
    },
    async ({ ticker, factors, return_type, window_days, method }) => {
      try {
        const body: Record<string, unknown> = { ticker: ticker.trim().toUpperCase() };
        if (factors !== undefined) body.factors = factors;
        if (return_type !== undefined) body.return_type = return_type;
        if (window_days !== undefined) body.window_days = window_days;
        if (method !== undefined) body.method = method;
        return textResult(await sdk.call("POST", "/correlation", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_residual_signal",
    {
      title: "RiskModels Residual Mean-Reversion Signal",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Aggregates the L3 residual mean-reversion signal across a basket of 1-100 tickers (POST /signals/residual-reversion/basket), with optional weights and a minimum signal-quality quintile.",
      inputSchema: {
        tickers: z.array(z.string().min(1)).min(1).max(100).describe("Basket tickers"),
        weights: z.array(z.number()).optional().describe("Optional weights, aligned to tickers"),
        signal_quality_min_quintile: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Drop names below this signal-quality quintile (1-5)"),
      },
    },
    async ({ tickers, weights, signal_quality_min_quintile }) => {
      try {
        const body: Record<string, unknown> = {
          tickers: tickers.map((t: string) => t.trim().toUpperCase()),
        };
        if (weights !== undefined) body.weights = weights;
        if (signal_quality_min_quintile !== undefined) body.signal_quality_min_quintile = signal_quality_min_quintile;
        return textResult(await sdk.call("POST", "/signals/residual-reversion/basket", { body }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- 13F filer detail ---

  server.registerTool(
    "riskmodels_get_filer_snapshot",
    {
      title: "RiskModels 13F Filer Snapshot",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Snapshot of one 13F filer (GET /13f/filers/{bw_filer_id}/snapshot): registry details, latest metrics and concentration. Accepts a bw_filer_id or a composite entity id (BW-SYNTH-*).",
      inputSchema: {
        bw_filer_id: z.string().min(1).describe("bw_filer_id (e.g. BW-FILER-CIK0001067983) or a composite entity id (BW-SYNTH-*)"),
      },
    },
    async ({ bw_filer_id }) => {
      try {
        return textResult(
          await sdk.call("GET", `/13f/filers/${encodeURIComponent(bw_filer_id.trim())}/snapshot`),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_filer_holdings",
    {
      title: "RiskModels 13F Filer Holdings",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Largest current holdings of one 13F filer (GET /13f/filers/{bw_filer_id}/holdings). The response also identifies the source filing: accession_number, filing_type (13F-HR original, 13F-HR/A amendment, 13F-NT notice) and amendment_type (ORIGINAL, RESTATEMENT, NEW_HOLDINGS or UNKNOWN). These are null on panels published before filing vintages were stored; a null amendment_type means unclassified. Accepts a bw_filer_id or a composite entity id (BW-SYNTH-*).",
      inputSchema: {
        bw_filer_id: z.string().min(1).describe("bw_filer_id (e.g. BW-FILER-CIK0001067983) or a composite entity id (BW-SYNTH-*)"),
        top: z.number().int().min(1).max(200).optional().describe("Number of holdings (default 25)"),
      },
    },
    async ({ bw_filer_id, top }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (top !== undefined) query.top = top;
        return textResult(
          await sdk.call("GET", `/13f/filers/${encodeURIComponent(bw_filer_id.trim())}/holdings`, { query }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- ETF detail ---

  server.registerTool(
    "riskmodels_get_etf",
    {
      title: "RiskModels ETF Metrics",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Latest metrics for one ETF (GET /data/etf/{ticker}): registry metadata and portfolio surface.",
      inputSchema: {
        ticker: z.string().min(1).describe("ETF ticker, e.g. SMH"),
      },
    },
    async ({ ticker }) => {
      try {
        return textResult(
          await sdk.call("GET", `/data/etf/${encodeURIComponent(ticker.trim().toUpperCase())}`),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_etf_holdings",
    {
      title: "RiskModels ETF Holdings",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description: "Largest current holdings of one ETF (GET /data/etf/{ticker}/holdings).",
      inputSchema: {
        ticker: z.string().min(1).describe("ETF ticker, e.g. SMH"),
        top: z.number().int().min(1).max(200).optional().describe("Number of holdings (default 25)"),
      },
    },
    async ({ ticker, top }) => {
      try {
        const query: Record<string, string | number | boolean> = {};
        if (top !== undefined) query.top = top;
        return textResult(
          await sdk.call("GET", `/data/etf/${encodeURIComponent(ticker.trim().toUpperCase())}/holdings`, { query }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "riskmodels_get_benchmark_fit",
    {
      title: "RiskModels Benchmark Fit (active weights)",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Compares a fund, 13F filer or ETF portfolio with a benchmark at a common date (GET /data/benchmark-fit): active share, active-weight RMS (a coarse tracking-error proxy), overlap, and the largest over- and underweights. Benchmarks: ff_own (free-float-cap weights of the subject's own holdings), the large and small style cells (cell_large-value, cell_large-blend, cell_large-growth, cell_small-value, cell_small-blend, cell_small-growth), or all (every available benchmark for the subject). $0.005 per call.",
      inputSchema: {
        subject: z
          .string()
          .min(1)
          .describe("BW-* portfolio id (BW-FUND-…, BW-FILER-…, BW-ETF-…) or an ETF ticker (→ BW-ETF-{TICKER})"),
        benchmark: z
          .enum(LIVE_FIT_BENCHMARKS)
          .describe("ff_own, a large or small style cell, or all"),
        as_of: z
          .string()
          .optional()
          .describe("YYYY-MM-DD upper bound on the subject teo (benchmark then at its latest teo ≤ the subject's)"),
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Top-N over/underweights (default 10, max 100)"),
      },
    },
    async ({ subject, benchmark, as_of, top }) => {
      try {
        const query: Record<string, string | number | boolean> = {
          subject: subject.trim(),
          benchmark: benchmark.trim(),
        };
        if (as_of !== undefined) query.as_of = as_of;
        if (top !== undefined) query.top = top;
        return textResult(await sdk.call("GET", "/data/benchmark-fit", { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- Generic reader: GET any catalog endpoint not covered by a typed tool ---

  server.registerTool(
    "riskmodels_call_endpoint",
    {
      title: "RiskModels REST Catalog Reader (GET)",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Read-only GET request to a RiskModels REST endpoint in the published catalog, for data without a dedicated tool (for example /industry-panel or /funds/{bw_fund_id}/holdings). Inputs: path relative to /api, and optional query parameters. Only GET endpoints are reachable; SQL, Plaid and chat endpoints are excluded. Billing follows the endpoint's REST price. API reference: https://riskmodels.app/docs/api",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('GET endpoint path relative to /api, e.g. "/industry-panel" or "/funds/BW-FUND-S000019457/holdings"'),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters"),
      },
    },
    async ({ path, query }) => {
      try {
        // Normalize FIRST (resolves ./.. and strips /api), then allowlist-match the
        // normalized path against registered, non-blocked capabilities. This is
        // traversal-safe: "/x/../cli/query" normalizes to "/cli/query", which is
        // not in the allowlist, so it is rejected — a prefix denylist on the raw
        // path would have let it through after URL normalization.
        const norm = normalizeApiPath(path);
        const allowed = passthroughAllowlist.some((a) => a.re.test(norm));
        if (!allowed) {
          return toolErrorResult({
            error: `GET ${norm} is not a catalog endpoint this tool can read. Only GET endpoints are reachable; SQL, Plaid and chat endpoints are excluded.`,
          });
        }
        return textResult(await sdk.call("GET", norm, { query }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function registerRiskModelsWhitepaperResources(server: McpLikeServer, dataDir: string): void {
  for (const resource of WHITEPAPER_RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: "RiskModels live white-paper markdown resource",
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: readWhitepaperFile(dataDir, resource.file),
          },
        ],
      }),
    );
  }
}

export function registerRiskModelsPrompts(
  server: McpLikeServer,
  firstLivePrompt: string,
): void {
  if (!server.registerPrompt) return;

  server.registerPrompt(
    "first_live_call",
    {
      title: "First live RiskModels call",
      description: "Live AAPL vs NVDA comparison from RiskModels data.",
    },
    () => promptText(firstLivePrompt),
  );

  server.registerPrompt(
    "follow_whitepaper",
    {
      title: "Follow the RiskModels White Paper",
      description: "Run the sequenced live paper flow with chart-ready examples.",
    },
    () =>
      promptText(`Follow the RiskModels white paper and run each live example.

Read these resources in order:
1. riskmodels://whitepaper/one-position-four-bets
2. riskmodels://whitepaper/chapter/01-core-claim
3. riskmodels://whitepaper/chapter/02-aapl-vs-nvda
4. riskmodels://whitepaper/chapter/03-hedging
5. riskmodels://examples/aapl-nvda-crwd

Then call:
1. riskmodels_whitepaper_example with exampleId "aapl-vs-nvda"
2. riskmodels_whitepaper_example with exampleId "aapl-nvda-crwd"
3. riskmodels_whitepaper_example with exampleId "nvda-10000-hedge"
4. riskmodels_whitepaper_example with exampleId "portfolio-decomposition"`),
  );

  server.registerPrompt(
    "reproduce_aapl_nvda",
    {
      title: "Reproduce AAPL vs NVDA",
      description: "Compare AAPL and NVDA using RiskModels and explain the risk layers.",
    },
    () =>
      promptText(firstLivePrompt),
  );

  server.registerPrompt(
    "hedge_single_position",
    {
      title: "Hedge a Single Position",
      description: "Scale hedge ratios to a dollar position.",
      argsSchema: {
        ticker: z.string().optional().describe("Ticker to hedge, default NVDA"),
        dollars: z.string().optional().describe("Dollar position, default 10000"),
      },
    },
    ({ ticker, dollars }) =>
      promptText(
        `Use riskmodels_hedge_position to hedge a $${dollars || "10000"} ${ticker || "NVDA"} position. Explain the ETF legs.`,
      ),
  );

  server.registerPrompt(
    "explain_my_portfolio",
    {
      title: "Explain My Portfolio",
      description: "Decompose a portfolio into RiskModels layers.",
    },
    () =>
      promptText(
        `Call riskmodels_get_my_positions first. If it returns a book with has_shorts true or more than 100 names, pass for_exposure to riskmodels_portfolio_exposure. Otherwise pass for_analysis to riskmodels_analyze_portfolio and for_hedge to riskmodels_hedge_portfolio. If the book is empty, ask for tickers and weights or dollar notionals, then call riskmodels_portfolio_decompose or riskmodels_analyze_portfolio, or riskmodels_portfolio_exposure with signed dollar values if any position is short. Explain the layers. Do not place orders.`,
      ),
  );
}
