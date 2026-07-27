import { readFileSync } from "fs";
import { join } from "path";
import { RiskModelsClient, type PositionInput, type WhitepaperExampleId } from "@riskmodels/sdk";
import { z } from "zod";

type McpContent = { type: "text"; text: string };
export type McpToolResult = { content: McpContent[] };
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
    handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }>,
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

const CHART_INSTRUCTION =
  "If chart_data is present, render the suggested_chart. Use grouped bars for comparisons and bars for single-stock decomposition. Always explain the result in plain English.";

export function textResult(payload: unknown): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            chart_instruction: CHART_INSTRUCTION,
            ...((payload && typeof payload === "object" && !Array.isArray(payload))
              ? (payload as Record<string, unknown>)
              : { data: payload }),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function errorResult(error: unknown): McpToolResult {
  return textResult({
    error: error instanceof Error ? error.message : String(error),
  });
}

function readWhitepaperFile(dataDir: string, file: string): string {
  return readFileSync(join(dataDir, "whitepaper", file), "utf-8");
}

function promptText(text: string): McpPromptResult {
  return {
    messages: [{ role: "user", content: { type: "text", text } }],
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

/** Allowlist of {method, path-pattern} the passthrough may dispatch — registered, non-blocked capabilities only. */
export function buildPassthroughAllowlist(
  capabilities: Array<{ method?: string; endpoint?: string }>,
): Array<{ method: string; re: RegExp }> {
  return capabilities
    .filter((c) => typeof c.method === "string" && typeof c.endpoint === "string")
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
  opts: { capabilities?: Array<{ method?: string; endpoint?: string; [k: string]: unknown }> } = {},
): void {
  const passthroughAllowlist = buildPassthroughAllowlist(opts.capabilities ?? []);

  server.registerTool(
    "riskmodels_decompose",
    {
      title: "RiskModels Single-Stock Decomposition",
      annotations: { readOnlyHint: true },
      description:
        "L3 four-bet view: decompose one stock into additive market, sector, subsector, and residual layers (same semantics as POST /decompose exposure/hedge). Returns chart_data and plain_english. To compare standalone L1 vs L2 vs L3 hedge solutions (HR/ER + ETF legs), call riskmodels_get_hedge_levels or read hedge_levels on the API response.",
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
      annotations: { readOnlyHint: true },
      description:
        "Daily dividend-adjusted total (gross) return series for any US stock or ETF (GET /ticker-returns), with per-day L3 market/sector/subsector hedge ratios and explained-risk fractions (sum to ~1.0). Up to 15 years of point-in-time, time-safe history. Use for performance tracking, backtests, or as the clean returns input to any risk or attribution work.",
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
      annotations: { readOnlyHint: true },
      description:
        "Daily return attribution (GET /returns-decomposition): decomposes each day's gross return into additive L1/L2/L3 factor (market/sector/subsector) and residual (stock-specific) return components from ds_erm3_returns. Isolates the residual return series — the stock-picking / alpha component — for manager-skill evaluation and stat-arb. Set include_lstar for the Lstar-dispatched residual series.",
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
      annotations: { readOnlyHint: true },
      description:
        "Per-(ticker, date) Lstar dispatch (GET /lstar): picks the simplest cascade level (L1/L2/L3) whose marginal explained-return clears the threshold (default 1%), then returns the chosen level's dispatched hedge ratios and daily residual_return[] aligned with dates[]. Use for stat-arb / manager-skill work on the idiosyncratic leg at the recommended hedge depth. Billing: $0.02/request.",
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
            "Cascade axis — industry only. style was removed in v4 (returns 400): style is a diagnostic block served by riskmodels_decompose / POST /v4/decompose; the industry cascade is the only hedge axis",
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
      annotations: { readOnlyHint: true },
      description:
        "Batch Lstar-dispatched residual returns for up to 100 tickers (POST /batch/lstar). Same marginal-ER selection rule as GET /lstar. Returns per-ticker dates, lstar level, residual_return[], and dispatched HRs. Billing: $0.005/ticker, minimum $0.01/call.",
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
          .describe("Marginal ER threshold for Lstar selection (default 0.01)"),
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
      annotations: { readOnlyHint: true },
      description:
        "Canonical L1, L2, and L3 hedge snapshots (semantic HR/ER + hedge_etfs) from GET /metrics/{ticker}. Use this when you need to compare which cascade depth to trade, distinct from decompose four-bet exposure.",
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
      annotations: { readOnlyHint: true },
      description:
        "Compare tickers across market, sector, subsector, and residual risk layers. Prefer grouped bar charts when chart_data is present.",
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
      annotations: { readOnlyHint: true },
      description:
        "Scale ETF hedge ratios for a ticker to a dollar position. Returns chart-ready hedge notionals.",
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
    "riskmodels_analyze_portfolio",
    {
      title: "RiskModels Portfolio hedge_levels aggregate",
      annotations: { readOnlyHint: true },
      description:
        "Holdings-weighted L1/L2/L3 hedge_levels across names via POST /batch/analyze (hedge_ratios). Returns normalized portfolio.portfolio_hedge_levels and per-ticker blocks when present.",
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
      annotations: { readOnlyHint: true },
      description:
        "Batch hedge_ratios at a chosen cascade level (L1/L2/L3), scale HRs by dollar notionals per ticker, and aggregate ETF USD hedge legs.",
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
    "riskmodels_portfolio_decompose",
    {
      title: "RiskModels Portfolio Decomposition",
      annotations: { readOnlyHint: true },
      description:
        "Decompose a weighted portfolio into market, sector, subsector, and residual risk layers.",
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
      annotations: { readOnlyHint: true },
      description:
        "Run a live example from the RiskModels white paper. Returns chapter text plus SDK/API output with chart_data.",
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
      annotations: { readOnlyHint: true },
      description:
        'Resolve a symbol or company name to RiskModels tickers (GET /tickers). Free — use this first to turn a name like "Nvidia" into a ticker before any analysis tool. mag7=true returns the Magnificent Seven.',
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
      annotations: { readOnlyHint: true },
      description:
        "Find 13F filers by name (GET /13f/filers/search). Free — resolve a manager like \"Berkshire\" to a bw_filer_id before pulling its snapshot, holdings, or concentration.",
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
      annotations: { readOnlyHint: true },
      description:
        "Find ETFs in the canonical universe by symbol or name (GET /data/etf/search). Free — resolve a hedge/benchmark ETF before pulling its metrics or holdings.",
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
      annotations: { readOnlyHint: true },
      description:
        "Where a stock sits in its sector/universe percentile for a given metric (GET /rankings/{ticker}) — peer analytics / manager-skill context.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. NVDA"),
        metric: z.string().optional().describe("Ranking metric (see riskmodels_get_capability id=rankings)"),
        cohort: z.string().optional().describe("Peer cohort, e.g. sector or universe"),
        window: z.string().optional().describe("Lookback window"),
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
    "riskmodels_get_fundamentals",
    {
      title: "RiskModels PIT Quarterly Fundamentals",
      annotations: { readOnlyHint: true },
      description:
        "PIT quarterly fundamentals (GET /fundamentals/{ticker}): TTM profitability ratios (roe_ttm, roa_ttm, fcf_margin), capital-return ratios (payout, retention, buyback, total_payout, sustainable_growth), leverage_ratio, ERM3 cascade betas, the cost-of-capital layer (cost_of_equity, wacc, economic_profit), and an equity-bridge decomposition. sec_facts carries raw line items per cell where the serving value is SEC XBRL (revenue, net income, equity, cash flows, dividends, buybacks); vendor-sourced cells are not exposed as raw. Rows are visible iff filed_date <= as_of — never \"latest\". Realized historical only; no forecasts or analyst fields. Set grid=true for a cost-of-capital sensitivity table across erp_grid x rf_tenor_grid instead of a scalar wacc/cost_of_equity.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol, e.g. AAPL"),
        as_of: z.string().optional().describe("Point-in-time date YYYY-MM-DD (default: today)"),
        periods: z.number().int().min(1).max(40).optional().describe("Quarterly rows returned, most recent last (default 8, max 40)"),
        erp: z.number().min(0).max(0.5).optional().describe("Equity risk premium for cost-of-capital (default 0.05)"),
        tax_rate: z.number().min(0).max(1).optional().describe("Tax rate applied to the WACC debt shield (default 0.21)"),
        rf_tenor: z
          .enum(["3m", "1y", "2y", "5y", "10y", "30y"])
          .optional()
          .describe("Treasury CMT tenor backing rf_rate (default 10y — pair a short tenor with a bill-basis ERP)"),
        grid: z
          .boolean()
          .optional()
          .describe("If true, response also carries sensitivity_grid: cost_of_equity/wacc/economic_profit across erp_grid x rf_tenor_grid for the latest PIT-visible period only"),
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
      annotations: { readOnlyHint: true },
      description:
        "Full cross-section rank screen (POST /rankings/screen): server-side percentile/decile filtering across the universe for a metric. Use to build screens, not single-ticker lookups.",
      inputSchema: {
        metric: z.string().min(1).describe("Ranking metric"),
        cohort: z.string().min(1).describe("Peer cohort"),
        window: z.string().min(1).describe("Lookback window"),
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
      annotations: { readOnlyHint: true },
      description:
        "Exposure of a stock's returns to macro drivers like rates and volatility (POST /correlation). Defaults to the L3 residual return so it isolates idiosyncratic macro sensitivity.",
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
      annotations: { readOnlyHint: true },
      description:
        "Aggregate the L3 residual mean-reversion (stat-arb) signal across a basket (POST /signals/residual-reversion/basket). Optional weights and a minimum signal-quality quintile filter.",
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
      annotations: { readOnlyHint: true },
      description:
        "Composed JSON snapshot for one 13F filer (GET /13f/filers/{bw_filer_id}/snapshot): registry + latest metrics + concentration. Resolve bw_filer_id via riskmodels_search_filers first. Composite entities (BW-SYNTH-*) are served by the same route.",
      inputSchema: {
        bw_filer_id: z.string().min(1).describe("Filer id from riskmodels_search_filers, or a composite entity id (BW-SYNTH-*)"),
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
      annotations: { readOnlyHint: true },
      description:
        "Top-N current holdings of a 13F filer (GET /13f/filers/{bw_filer_id}/holdings). Resolve bw_filer_id via riskmodels_search_filers first. Composite entities (BW-SYNTH-*) are served by the same route. The response root also identifies the filing the panel came from: accession_number, filing_type (the SEC form type — 13F-HR original, 13F-HR/A amendment, 13F-NT notice) and amendment_type (ORIGINAL / RESTATEMENT / NEW_HOLDINGS / UNKNOWN). These are null on panels published before the accession-vintage stores; a null amendment_type means unclassified upstream, not UNKNOWN, and is never inferred from a /A suffix.",
      inputSchema: {
        bw_filer_id: z.string().min(1).describe("Filer id from riskmodels_search_filers, or a composite entity id (BW-SYNTH-*)"),
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
      annotations: { readOnlyHint: true },
      description:
        "Latest canonical metrics for one ETF (GET /data/etf/{ticker}): registry metadata + portfolio surface. Resolve the ticker via riskmodels_search_etfs if unsure.",
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
      annotations: { readOnlyHint: true },
      description: "Top-N current holdings of an ETF (GET /data/etf/{ticker}/holdings).",
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
      annotations: { readOnlyHint: true },
      description:
        "Fit a portfolio surface (fund / 13F filer / ETF) against a benchmark at a common teo (GET /data/benchmark-fit): active share, active-weight RMS (coarse tracking-error proxy), overlap, and the top over/underweights. Static benchmarks (SPY, 70/30, … or a bw_bench_id) are free; custom benches are billed $0.005 (bench-active-custom): `ff_own` = free-float-cap benchmark of the subject's OWN holdings (conviction vs what market cap alone implies; see benchmark_provenance.cap_coverage), `cell_<9box-slug>` (e.g. cell_large-growth) = the style cell's MV weight surface, `all` = SPY + ff_own + the subject's declared style cell in one call.",
      inputSchema: {
        subject: z
          .string()
          .min(1)
          .describe("BW-* portfolio id (BW-FUND-…, BW-FILER-…, BW-ETF-…) or an ETF ticker (→ BW-ETF-{TICKER})"),
        benchmark: z
          .string()
          .min(1)
          .describe("Static alias (SPY, 70/30, …) or bw_bench_id — free; or ff_own | cell_<9box-slug> | all — billed $0.005"),
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

  // --- Generic passthrough: invoke any capability not covered by a typed tool ---

  server.registerTool(
    "riskmodels_call_endpoint",
    {
      title: "RiskModels Generic Capability Call",
      annotations: { readOnlyHint: true },
      description:
        'Escape hatch for any capability without a dedicated tool. Run riskmodels_list_endpoints (and riskmodels_get_capability for params), then call with that capability\'s method + endpoint path. Path is relative to the API root (a leading "/api" is stripped). Blocked: SQL (/cli/query), Plaid, and chat endpoints — use the REST API directly for those.',
      inputSchema: {
        method: z.enum(["GET", "POST"]).describe("HTTP method from list_endpoints"),
        path: z
          .string()
          .min(1)
          .describe('Endpoint path from list_endpoints, e.g. "/industry-panel" or "/data/benchmark/SPY"'),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters"),
        body: z.record(z.string(), z.unknown()).optional().describe("JSON body (POST)"),
      },
    },
    async ({ method, path, query, body }) => {
      try {
        // Normalize FIRST (resolves ./.. and strips /api), then allowlist-match the
        // normalized path against registered, non-blocked capabilities. This is
        // traversal-safe: "/x/../cli/query" normalizes to "/cli/query", which is
        // not in the allowlist, so it is rejected — a prefix denylist on the raw
        // path would have let it through after URL normalization.
        const norm = normalizeApiPath(path);
        const allowed = passthroughAllowlist.some((a) => a.method === method && a.re.test(norm));
        if (!allowed) {
          return errorResult(
            new Error(
              `Path ${norm} (${method}) is not an invocable capability. Run riskmodels_list_endpoints for the allowed set; SQL/Plaid/chat are not exposed via the passthrough.`,
            ),
          );
        }
        return textResult(await sdk.call(method, norm, { query, body }));
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

export function registerRiskModelsPrompts(server: McpLikeServer): void {
  if (!server.registerPrompt) return;

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
4. riskmodels_whitepaper_example with exampleId "portfolio-decomposition"

${CHART_INSTRUCTION}`),
  );

  server.registerPrompt(
    "reproduce_aapl_nvda",
    {
      title: "Reproduce AAPL vs NVDA",
      description: "Compare AAPL and NVDA using RiskModels and explain the risk layers.",
    },
    () =>
      promptText(
        `Compare AAPL and NVDA using RiskModels. What am I really betting on? Use riskmodels_compare and render a grouped bar chart from chart_data.`,
      ),
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
        `Use riskmodels_hedge_position to hedge a $${dollars || "10000"} ${ticker || "NVDA"} position. Render the suggested chart and explain the ETF legs in plain English.`,
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
        `Ask me for tickers and weights or dollar notionals, then call riskmodels_portfolio_decompose (L3 four-bet aggregation) or riskmodels_analyze_portfolio for holdings-weighted hedge_levels across L1/L2/L3. Render chart_data using suggested_chart and explain the layers.`,
      ),
  );
}
