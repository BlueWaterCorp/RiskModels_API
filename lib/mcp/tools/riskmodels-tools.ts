import { readFileSync } from "fs";
import { join } from "path";
import { RiskModelsClient, type PositionInput } from "@riskmodels/sdk";
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

/**
 * The RiskModels MCP tool set 2.0, in registration order. All three surfaces
 * (npm stdio `mcp/src/server.ts`, hosted `/api/mcp/sse` and hosted
 * `/api/mcp/openai`, both via `lib/mcp/server.ts`) register exactly these
 * tools through `registerRiskModelsTools`. The hosted surfaces add
 * HOSTED_ONLY_TOOL_NAMES (see lib/mcp/render-tool.ts).
 */
export const RISKMODELS_TOOL_NAMES = [
  "riskmodels_get_stock_snapshot",
  "riskmodels_decompose",
  "riskmodels_compare",
  "riskmodels_get_returns",
  "riskmodels_get_return_attribution",
  "riskmodels_get_residual_returns",
  "riskmodels_get_residual_signal",
  "riskmodels_get_macro_correlation",
  "riskmodels_get_fundamentals",
  "riskmodels_analyze_portfolio",
  "riskmodels_get_portfolio_risk_snapshot",
  "riskmodels_portfolio_exposure",
  "riskmodels_decompose_selection_vs_drift",
  "riskmodels_get_my_positions",
  "riskmodels_get_rankings",
  "riskmodels_screen_rankings",
  "riskmodels_get_cohorts",
  "riskmodels_get_peers",
  "riskmodels_search",
  "riskmodels_resolve_security_identity",
  "riskmodels_get_filer",
  "riskmodels_get_fund",
  "riskmodels_get_etf",
  "riskmodels_get_benchmark_fit",
  "riskmodels_get_factor_returns",
] as const;

/** Registered only by the hosted server: needs the GCP render service. */
export const HOSTED_ONLY_TOOL_NAMES = ["riskmodels_render_artifact"] as const;

/** Freshness sentence shared by the end-of-day model-data tools. */
const EOD = "End-of-day data, refreshed after each US market close.";

type Query = Record<string, string | number | boolean>;

function setIf(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function upper(ticker: string): string {
  return ticker.trim().toUpperCase();
}

const tickerParam = (example = "NVDA") =>
  z.string().min(1).describe(`US stock ticker symbol, case-insensitive, e.g. ${example}`);

const isoDate = (what: string, example = "2026-06-30") =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(`${what}, format YYYY-MM-DD, e.g. ${example}`);

/** One GET an entity tool makes, with its list price (capability registry). */
type EntityLeg = { path: string; query?: Query; usd: number };

/** A failed include call: the HTTP status and reason the SDK error carries. */
export function includeFailure(error: unknown): { ok: false; status: number | null; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  const m = /^RiskModels API (?:HTTP (\d{3}): ([^]*)|request failed with HTTP (\d{3}))$/.exec(message);
  if (!m) return { ok: false, status: null, error: message };
  return { ok: false, status: Number(m[1] ?? m[3]), error: m[2] ?? message };
}

/** Months of history the *_history and concentration include values request by default. */
export const INCLUDE_HISTORY_MONTHS = 24;

/** start_date (YYYY-MM-DD, UTC) `months` months before `now`, the lower bound of a history include. */
export function historyStartDate(months: number, now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

const usd = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Snapshot and holdings run in order; either failing fails the tool and no
 * include fires. Includes then run together (Promise.allSettled): a failed
 * include becomes { ok: false, status, error } and leaves the result a success.
 * billing sums the list prices of the calls that succeeded (failed REST calls
 * are not charged).
 */
async function entityWithIncludes(
  sdk: Pick<RiskModelsClient, "call">,
  base: { snapshot?: EntityLeg; holdings?: EntityLeg },
  includes: Record<string, EntityLeg>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let baseUsd = 0;
  for (const key of ["snapshot", "holdings"] as const) {
    const leg = base[key];
    if (!leg) continue;
    out[key] = await sdk.call("GET", leg.path, leg.query ? { query: leg.query } : {});
    baseUsd += leg.usd;
  }
  const names = Object.keys(includes);
  const settled = await Promise.allSettled(
    names.map((n) => sdk.call("GET", includes[n]!.path, includes[n]!.query ? { query: includes[n]!.query } : {})),
  );
  const blocks: Record<string, unknown> = {};
  const includesUsd: Record<string, number> = {};
  settled.forEach((s, i) => {
    const n = names[i]!;
    blocks[n] = s.status === "fulfilled" ? s.value : includeFailure(s.reason);
    includesUsd[n] = s.status === "fulfilled" ? includes[n]!.usd : 0;
  });
  out.includes = blocks;
  out.billing = {
    base_usd: usd(baseUsd),
    includes_usd: includesUsd,
    total_usd: usd(baseUsd + Object.values(includesUsd).reduce((a, b) => a + b, 0)),
  };
  return out;
}

const SNAPSHOT_PARAM = (what: string) =>
  z
    .boolean()
    .optional()
    .describe(
      `Also fetch the ${what} snapshot, e.g. false for holdings only (default true; false needs holdings or an include value)`,
    );

const HISTORY_MONTHS_PARAM = z
  .number()
  .int()
  .min(1)
  .max(60)
  .optional()
  .describe(
    `Months of history for the history and concentration include values, integer 1-60, e.g. 36 (default ${INCLUDE_HISTORY_MONTHS})`,
  );

type SdkSubset = Pick<
  RiskModelsClient,
  | "decompose"
  | "hedgePosition"
  | "compare"
  | "analyzePortfolio"
  | "hedgePortfolio"
  | "getReturns"
  | "getReturnAttribution"
  | "call"
>;

export function registerRiskModelsTools(
  sdk: SdkSubset,
  server: McpLikeServer,
  opts: {
    /** Caller's RiskModels API key. The linked-book tool forwards it to riskmodels.net. */
    apiKey?: string | null;
    /** Override https://riskmodels.net for tests. */
    portalBase?: string;
    fetchPositions?: typeof fetch;
  } = {},
): void {
  const run = async (fn: () => Promise<unknown>): Promise<McpToolResult> => {
    try {
      return textResult(await fn());
    } catch (error) {
      return errorResult(error);
    }
  };

  // --- Single stock: latest risk ---

  server.registerTool(
    "riskmodels_get_stock_snapshot",
    {
      title: "RiskModels Stock Risk Snapshot",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need one US stock's latest risk numbers: hedge ratios to SPY and to its sector and subsector ETFs, explained-risk shares by layer, volatility, closing price and market cap. Not for a layer-by-layer decomposition or the ETF hedge of a dollar position (use riskmodels_decompose), several stocks at once (use riskmodels_compare) or daily history (use riskmodels_get_returns). Returns the latest row of GET /metrics/{ticker}, including the hedge_levels block with hedge ratios, explained risk and hedge ETFs at L1, L2 and L3. " +
        EOD +
        " Price: $0.005 per call.",
      inputSchema: {
        ticker: tickerParam("NVDA"),
      },
    },
    async ({ ticker }) => run(() => sdk.call("GET", `/metrics/${encodeURIComponent(upper(ticker))}`)),
  );

  server.registerTool(
    "riskmodels_decompose",
    {
      title: "RiskModels Single-Stock Decomposition",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want one stock's risk split into market, sector, subsector and residual layers, or the ETF hedge legs for a dollar position in it. Not for several stocks (use riskmodels_compare) or a portfolio (use riskmodels_analyze_portfolio). Returns, from POST /decompose, each layer's explained-risk share, hedge ratio and hedge ETF, chart-ready data and a one-line summary; with dollars it returns the ETF hedge notionals for that position at each level (hedge ratio times dollars). " +
        EOD +
        " Price: $0.005 per call.",
      inputSchema: {
        ticker: tickerParam("NVDA"),
        dollars: z
          .number()
          .positive()
          .optional()
          .describe("Position size in US dollars, a positive number, e.g. 10000. Omit for the decomposition alone"),
      },
    },
    async ({ ticker, dollars }) =>
      run(() => (dollars === undefined ? sdk.decompose(ticker) : sdk.hedgePosition({ ticker, dollars }))),
  );

  server.registerTool(
    "riskmodels_compare",
    {
      title: "RiskModels Multi-Ticker Comparison",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want 2-100 stocks side by side on market, sector, subsector and residual risk. Not for one stock (use riskmodels_decompose) or a weighted portfolio (use riskmodels_analyze_portfolio). Returns, from POST /batch/analyze, each ticker's explained-risk shares and hedge ratios by layer, with chart-ready data. " +
        EOD +
        " Price: $0.015 per ticker, minimum $0.03 per call.",
      inputSchema: {
        tickers: z
          .array(z.string().min(1))
          .min(2)
          .max(100)
          .describe('2-100 US stock ticker symbols, e.g. ["AAPL","NVDA"]'),
      },
    },
    async ({ tickers }) => run(() => sdk.compare(tickers)),
  );

  // --- Single stock: history ---

  server.registerTool(
    "riskmodels_get_returns",
    {
      title: "RiskModels Stock Total Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need the daily dividend-adjusted total returns of one US stock or ETF over 1-15 years. Not for returns split into factor and residual parts (use riskmodels_get_return_attribution) or residual returns at the recommended hedge depth (use riskmodels_get_residual_returns). Returns, from GET /ticker-returns, the daily return series (decimal, 0.01 = 1%) with each day's L3 market, sector and subsector hedge ratios and explained-risk shares; history is point-in-time. ETFs have three capabilities, any combination per fund: cascade (SPY, sector and subsector hedge legs), priced (daily returns, covariance, beta to SPY) and holdings (look-through); only priced ETFs return rows, and an empty response says why (etf_outside_priced_universe or etf_no_return_history_in_window) and is not billed. " +
        EOD +
        " Price: $0.02 per call plus $0.01 per year of history beyond the first; $0 when no rows return.",
      inputSchema: {
        ticker: tickerParam("AAPL"),
        years: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("Years of daily history, integer 1-15, e.g. 3 (default 1)"),
      },
    },
    async ({ ticker, years }) => run(() => sdk.getReturns(ticker, { years })),
  );

  server.registerTool(
    "riskmodels_get_return_attribution",
    {
      title: "RiskModels Return Attribution (factor vs residual)",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need each day's return of one stock split into market, sector and subsector factor returns and the residual (stock-specific) return. Not for raw total returns (use riskmodels_get_returns) or residual returns for many stocks (use riskmodels_get_residual_returns). Returns, from GET /returns-decomposition, the daily gross return and its additive components (decimal returns); include_lstar adds the residual series at each day's recommended hedge depth. " +
        EOD +
        " Price: $0.04 per call plus $0.01 per year of history beyond the first.",
      inputSchema: {
        ticker: tickerParam("AAPL"),
        years: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Calendar years of daily history, integer, e.g. 2 (default 1)"),
        market_factor_etf: z
          .string()
          .optional()
          .describe("ETF ticker used as the market factor, e.g. QQQ (default SPY)"),
        include_lstar: z
          .boolean()
          .optional()
          .describe("true adds the lstar level and lstar_residual_return arrays, e.g. true (default false)"),
        threshold: z
          .number()
          .optional()
          .describe("Marginal explained-risk threshold for the hedge-depth rule, a fraction, e.g. 0.01 (default 0.01)"),
      },
    },
    async ({ ticker, years, market_factor_etf, include_lstar, threshold }) =>
      run(() =>
        sdk.getReturnAttribution(ticker, {
          years,
          marketFactorEtf: market_factor_etf,
          includeLstar: include_lstar,
          threshold,
        }),
      ),
  );

  server.registerTool(
    "riskmodels_get_residual_returns",
    {
      title: "RiskModels Residual Returns and Recommended Hedge Depth",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need daily residual (stock-specific) returns and the recommended hedge depth (L1 market, L2 sector or L3 subsector) for 1-100 stocks. Not for the full factor split of each day's return (use riskmodels_get_return_attribution) or a mean-reversion signal on a basket (use riskmodels_get_residual_signal). Returns, per ticker, the recommended depth by date, the hedge ratios at that depth and the daily residual return series. One ticker is served by GET /lstar; 2-100 tickers by POST /batch/lstar. Without threshold the depth is the one ERM3 publishes; with threshold it is the simplest depth whose marginal explained risk exceeds the threshold. " +
        EOD +
        " Price: one ticker $0.02 plus $0.01 per year beyond the first; 2-100 tickers $0.015 per ticker plus $0.0075 per ticker per year beyond the first, minimum $0.03 per call.",
      inputSchema: {
        tickers: z
          .array(z.string().min(1))
          .min(1)
          .max(100)
          .describe('1-100 US stock ticker symbols, e.g. ["NVDA"] or ["AAPL","MSFT"]'),
        years: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("Calendar years of daily history, integer 1-15, e.g. 3 (default 1)"),
        market_factor_etf: z
          .string()
          .optional()
          .describe("ETF ticker used as the market factor, e.g. QQQ (default SPY)"),
        threshold: z
          .number()
          .optional()
          .describe(
            "Marginal explained-risk threshold, a fraction, e.g. 0.01. Omit for the depth ERM3 publishes",
          ),
      },
    },
    async ({ tickers, years, market_factor_etf, threshold }) =>
      run(() => {
        const list = (tickers as string[]).map(upper);
        if (list.length === 1) {
          const query: Query = { ticker: list[0]! };
          setIf(query, "years", years);
          setIf(query, "market_factor_etf", market_factor_etf);
          setIf(query, "threshold", threshold);
          return sdk.call("GET", "/lstar", { query });
        }
        const body: Record<string, unknown> = { tickers: list };
        setIf(body, "years", years);
        setIf(body, "market_factor_etf", market_factor_etf);
        setIf(body, "threshold", threshold);
        return sdk.call("POST", "/batch/lstar", { body });
      }),
  );

  server.registerTool(
    "riskmodels_get_residual_signal",
    {
      title: "RiskModels Residual Mean-Reversion Signal",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want the L3 residual mean-reversion signal aggregated over a basket of 1-100 stocks. Not for the residual return series themselves (use riskmodels_get_residual_returns). Returns, from POST /signals/residual-reversion/basket, the basket-aggregated signal, with optional weights and a minimum signal-quality quintile; it describes recent residual moves and is not a forecast. " +
        EOD +
        " Price: $0.02 per call.",
      inputSchema: {
        tickers: z
          .array(z.string().min(1))
          .min(1)
          .max(100)
          .describe('1-100 basket ticker symbols, e.g. ["AAPL","MSFT","NVDA"]'),
        weights: z
          .array(z.number())
          .optional()
          .describe("Weights aligned to tickers, decimals, e.g. [0.5,0.3,0.2] (default equal weight)"),
        signal_quality_min_quintile: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Drop names below this signal-quality quintile, integer 1-5, e.g. 3"),
      },
    },
    async ({ tickers, weights, signal_quality_min_quintile }) =>
      run(() => {
        const body: Record<string, unknown> = { tickers: (tickers as string[]).map(upper) };
        setIf(body, "weights", weights);
        setIf(body, "signal_quality_min_quintile", signal_quality_min_quintile);
        return sdk.call("POST", "/signals/residual-reversion/basket", { body });
      }),
  );

  server.registerTool(
    "riskmodels_get_macro_correlation",
    {
      title: "RiskModels Macro Factor Correlation",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want to know how one stock's returns co-move with macro factors such as rates, credit, oil, the dollar or volatility. Not for the macro factor return series themselves (use riskmodels_get_factor_returns). Returns, from POST /correlation, Pearson or Spearman correlations over a trailing window, using the L3 residual return by default. " +
        EOD +
        " Price: $0.01 per call.",
      inputSchema: {
        ticker: tickerParam("NVDA"),
        factors: z
          .array(z.string())
          .optional()
          .describe('Macro factor keys, e.g. ["oil","usd","term_spread"] (default: the standard set)'),
        return_type: z
          .string()
          .optional()
          .describe('Return series to correlate, e.g. "gross" (default "l3_residual")'),
        window_days: z
          .number()
          .int()
          .optional()
          .describe("Trailing window in trading days, integer, e.g. 126 (default 252)"),
        method: z.string().optional().describe('"pearson" or "spearman", e.g. "spearman" (default "pearson")'),
      },
    },
    async ({ ticker, factors, return_type, window_days, method }) =>
      run(() => {
        const body: Record<string, unknown> = { ticker: upper(ticker) };
        setIf(body, "factors", factors);
        setIf(body, "return_type", return_type);
        setIf(body, "window_days", window_days);
        setIf(body, "method", method);
        return sdk.call("POST", "/correlation", { body });
      }),
  );

  server.registerTool(
    "riskmodels_get_fundamentals",
    {
      title: "RiskModels PIT Quarterly Fundamentals",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need point-in-time quarterly fundamentals or CAPM cost of capital for one stock. Not for risk or hedge numbers (use riskmodels_get_stock_snapshot). Returns, from GET /fundamentals/{ticker}: TTM profitability and capital-return ratios, leverage, ERM3 valuation betas, cost_of_debt and wacc from reported data, separately labelled cost_of_debt_imputed and wacc_imputed from a market proxy (10-year Treasury plus a high-quality corporate spread, not issuer-specific), economic profit, an equity-bridge decomposition and SEC line items (sec_facts). A quarter is included only if it was filed on or before as_of. grid=true adds an ERP x Treasury-tenor table of cost of equity, wacc, wacc_imputed and economic profit for the latest period. Realized history only, no forecasts; filings are picked up end-of-day. Price: $0.02 per call.",
      inputSchema: {
        ticker: tickerParam("AAPL"),
        as_of: isoDate("Point-in-time date; only quarters filed on or before it are returned (default today)", "2025-12-31"),
        periods: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("Quarterly rows returned, most recent last, integer 1-40, e.g. 12 (default 8)"),
        erp: z
          .number()
          .min(0)
          .max(0.5)
          .optional()
          .describe("Equity risk premium as a decimal, e.g. 0.055 for 5.5% (default 0.05)"),
        tax_rate: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Tax rate for the WACC debt shield as a decimal, e.g. 0.25 (default 0.21)"),
        rf_tenor: z
          .enum(["3m", "1y", "2y", "5y", "10y", "30y"])
          .optional()
          .describe("Treasury constant-maturity tenor for the risk-free rate, e.g. 10y (default 10y); pair a short tenor with a bill-basis ERP"),
        grid: z
          .boolean()
          .optional()
          .describe("true adds sensitivity_grid (cost_of_equity, wacc, wacc_imputed, economic_profit) across erp_grid x rf_tenor_grid for the latest period, e.g. true (default false)"),
        erp_grid: z
          .string()
          .optional()
          .describe('Comma-separated ERP decimals for the grid, e.g. "0.03,0.04,0.05,0.06,0.07"; used only when grid=true'),
        rf_tenor_grid: z
          .string()
          .optional()
          .describe('Comma-separated tenors for the grid, e.g. "1y,10y,30y"; used only when grid=true'),
      },
    },
    async ({ ticker, as_of, periods, erp, tax_rate, rf_tenor, grid, erp_grid, rf_tenor_grid }) =>
      run(() => {
        const query: Query = {};
        setIf(query, "as_of", as_of);
        setIf(query, "periods", periods);
        setIf(query, "erp", erp);
        setIf(query, "tax_rate", tax_rate);
        setIf(query, "rf_tenor", rf_tenor);
        setIf(query, "grid", grid);
        setIf(query, "erp_grid", erp_grid);
        setIf(query, "rf_tenor_grid", rf_tenor_grid);
        return sdk.call("GET", `/fundamentals/${encodeURIComponent(upper(ticker))}`, { query });
      }),
  );

  // --- Portfolio ---

  server.registerTool(
    "riskmodels_analyze_portfolio",
    {
      title: "RiskModels Portfolio Hedge Levels and ETF Hedge",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you have a long-only book of up to 100 names and want its holdings-weighted L1, L2 and L3 hedge ratios, or the ETF hedge notionals for dollar positions. Not for books with shorts or more than 100 names (use riskmodels_portfolio_exposure) or a variance decomposition with return attribution (use riskmodels_get_portfolio_risk_snapshot). Returns, from POST /batch/analyze, portfolio hedge levels at L1, L2 and L3 with per-ticker detail. Only when every position is given in dollars does it also return the ETF hedge notionals at hedge_level (set by level, default L3), by ticker and summed by ETF; with weights, level is ignored. " +
        EOD +
        " Price: $0.015 per position, minimum $0.03 per call.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1).describe("US stock ticker symbol, e.g. AAPL"),
              weight: z.number().positive().optional().describe("Positive portfolio weight, any scale, e.g. 0.4"),
              dollars: z.number().positive().optional().describe("Positive position value in US dollars, e.g. 25000"),
            }),
          )
          .min(1)
          .max(100)
          .describe(
            'Long positions, each with weight or dollars, combined per ticker, e.g. [{"ticker":"AAPL","dollars":25000},{"ticker":"NVDA","dollars":15000}]',
          ),
        level: z
          .enum(["L1", "L2", "L3"])
          .optional()
          .describe("Hedge depth for the ETF notionals, used only when every position is in dollars, e.g. L2 (default L3)"),
        years: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe("Lookback window in years, integer 1-30, e.g. 2 (default 1)"),
      },
    },
    async ({ positions, level, years }) =>
      run(() => {
        const rows = positions as PositionInput[];
        const allDollars = rows.every((p) => p.dollars !== undefined && p.weight === undefined);
        if (allDollars) {
          return sdk.hedgePortfolio(
            rows.map((p) => ({ ticker: p.ticker, dollars: p.dollars as number })),
            { level, years },
          );
        }
        return sdk.analyzePortfolio(rows, { years });
      }),
  );

  server.registerTool(
    "riskmodels_get_portfolio_risk_snapshot",
    {
      title: "RiskModels Portfolio Risk Snapshot",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want a long-only portfolio's risk decomposed into market, sector, subsector and residual variance, with diversification analytics and return attribution. Not for long/short books (use riskmodels_portfolio_exposure) or ETF hedge notionals (use riskmodels_analyze_portfolio). Returns, from POST /snapshot (the canonical portfolio snapshot), the L3 variance decomposition, per-position L3 hedge ratios, diversification analytics with sector and subsector ETF correlations, frozen-weight daily return attribution, cumulative return and drawdown over lookback_days, and a risk summary with dominant drivers and concentration flags. " +
        EOD +
        " Price: $1.25 per call.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1).describe("US stock ticker symbol, e.g. NVDA"),
              weight: z.number().positive().optional().describe("Positive weight, any scale (normalized server-side), e.g. 0.35"),
              dollars: z.number().positive().optional().describe("Positive position value in US dollars, used as the weight, e.g. 35000"),
              shares: z
                .number()
                .positive()
                .optional()
                .describe("Share count, converted to a weight at the latest close, e.g. 120"),
            }),
          )
          .min(1)
          .max(100)
          .describe(
            'Long positions, each with one of weight, dollars or shares (shares on every position or none), e.g. [{"ticker":"AAPL","weight":0.4},{"ticker":"NVDA","weight":0.35},{"ticker":"CRWD","weight":0.25}]',
          ),
        lookback_days: z
          .number()
          .int()
          .min(20)
          .max(2000)
          .optional()
          .describe("Trading days of history for returns, attribution and the diversification window, integer 20-2000, e.g. 504 (default 252)"),
        benchmark: z.string().optional().describe("Benchmark ticker, e.g. SPY"),
      },
    },
    async ({ positions, lookback_days, benchmark }) => {
      const portfolio: Array<Record<string, unknown>> = [];
      for (const p of positions as Array<{ ticker: string; weight?: number; dollars?: number; shares?: number }>) {
        const w = p.weight ?? p.dollars;
        if ((w !== undefined) === (p.shares !== undefined)) {
          return toolErrorResult({ error: `Position ${p.ticker} needs exactly one of weight, dollars or shares.` });
        }
        portfolio.push(p.shares !== undefined ? { ticker: upper(p.ticker), shares: p.shares } : { ticker: upper(p.ticker), weight: w });
      }
      const body: Record<string, unknown> = { type: "portfolio", portfolio, lookback_days: lookback_days ?? 252 };
      setIf(body, "benchmark", benchmark);
      return run(() => sdk.call("POST", "/snapshot", { body }));
    },
  );

  server.registerTool(
    "riskmodels_portfolio_exposure",
    {
      title: "RiskModels Long/Short Portfolio Exposure",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when a book has short positions or more than 100 names, or when you want its beta-dollars and the ETF trades that neutralise it. Not for long-only books of up to 100 names given as weights (use riskmodels_analyze_portfolio). Returns, from POST /portfolio/exposure, L1 beta-dollars by sector plus the market beta on the risk basis (beta.risk_basis: the exposure vector times the ETF covariance), the ETF trades that neutralise the book at L1, L2 and L3, systematic and residual dollar risk at hedge_level (default lstar: each name at its own recommended depth), scenario inputs (each ETF's beta to SPY; per-name level, L1 beta, hedge ratios and residual volatility with include_positions), coverage (positions not modelled, with reasons; a known ETF it cannot price is etf_outside_priced_universe or etf_no_return_history_in_window, not symbol_not_found) and warnings. Positions are netted by security and not rescaled. " +
        EOD +
        " Price: $0.25 per call up to 25 modelled names, $1.00 above.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1).describe("US stock ticker symbol, e.g. TSLA"),
              value: z
                .number()
                .finite()
                .refine((v) => v !== 0, "value must be non-zero (signed dollars; short < 0)")
                .describe("Signed market value in US dollars, short < 0, e.g. -50000"),
            }),
          )
          .min(1)
          .max(1000)
          .describe('Signed book of 1-1000 positions, e.g. [{"ticker":"AAPL","value":100000},{"ticker":"TSLA","value":-50000}]'),
        hedge_level: z
          .enum(["lstar", "l1", "l2", "l3"])
          .optional()
          .describe("lstar: each name at its own recommended depth; l1/l2/l3: one depth for every name, e.g. l3 (default lstar)"),
        lookback_days: z
          .number()
          .int()
          .min(60)
          .max(756)
          .optional()
          .describe("Trading days in the ETF covariance window, integer 60-756, e.g. 126 (default 252)"),
        as_of: isoDate(
          "Past model date, 2011-12-07 or later; before 2013-01-01 lstar uses L3 (default latest)",
          "2024-12-31",
        ),
        top_contributors: z
          .union([z.literal("all"), z.number().int().min(1).max(1000)])
          .optional()
          .describe('Names listed in risk.residual.top_contributors, integer 1-1000 or "all", e.g. 50 (default 15)'),
        include_positions: z
          .boolean()
          .optional()
          .describe("Add per-name scenario rows (level, L1 beta, hedge ratios, residual volatility), e.g. true (default false)"),
      },
    },
    async ({ positions, hedge_level, lookback_days, as_of, top_contributors, include_positions }) =>
      run(() => {
        const body: Record<string, unknown> = {
          positions: (positions as Array<{ ticker: string; value: number }>).map((row) => ({
            ticker: upper(row.ticker),
            value: row.value,
          })),
        };
        setIf(body, "hedge_level", hedge_level);
        setIf(body, "lookback_days", lookback_days);
        setIf(body, "as_of", as_of);
        setIf(body, "top_contributors", top_contributors);
        setIf(body, "include_positions", include_positions);
        return sdk.call("POST", "/portfolio/exposure", { body });
      }),
  );

  server.registerTool(
    "riskmodels_decompose_selection_vs_drift",
    {
      title: "RiskModels Selection vs Drift",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want a book's realized residual return over a date window attributed to stock selection versus drift. Not for current risk or hedges (use riskmodels_portfolio_exposure). Returns, from POST /cohorts/pnl-decomposition, selection (from holding names that beat their cohort's average residual) and drift (from net exposure to the cohort average), which sum exactly to the total; weights are held constant over the window and not normalized, a short is a negative weight, and positions that cannot be mapped to a cohort are listed in coverage.dropped. Historical attribution on end-of-day data. Price: $0.25 per call.",
      inputSchema: {
        positions: z
          .array(
            z.object({
              ticker: z.string().min(1).describe("US stock ticker symbol, e.g. MSFT"),
              weight: z.number().describe("Portfolio weight as a decimal, negative for a short, e.g. -0.05"),
            }),
          )
          .min(1)
          .max(500)
          .describe('The book to attribute, 1-500 positions, e.g. [{"ticker":"MSFT","weight":0.1},{"ticker":"INTC","weight":-0.05}]'),
        level: z
          .enum(["market", "sector"])
          .optional()
          .describe("Cohort level, e.g. market (default sector)"),
        start_date: isoDate("Window start", "2026-01-02"),
        end_date: isoDate("Window end", "2026-06-30"),
        min_names: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Ignore cohort means on days the cohort had fewer members, integer, e.g. 20"),
        include_series: z
          .boolean()
          .optional()
          .describe("true adds the daily selection and drift series (large), e.g. true (default false)"),
      },
    },
    async ({ positions, level, start_date, end_date, min_names, include_series }) =>
      run(() => {
        const body: Record<string, unknown> = { positions };
        setIf(body, "level", level);
        setIf(body, "start_date", start_date);
        setIf(body, "end_date", end_date);
        setIf(body, "min_names", min_names);
        setIf(body, "include_series", include_series);
        return sdk.call("POST", "/cohorts/pnl-decomposition", { body });
      }),
  );

  server.registerTool(
    "riskmodels_get_my_positions",
    {
      title: "RiskModels linked brokerage positions",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when the request concerns the caller's own linked brokerage book. Not for a book typed into the conversation (use riskmodels_analyze_portfolio or riskmodels_portfolio_exposure). Returns the caller's positions from their default riskmodels.net portfolio (Alpaca Connect, Connect Trade or Plaid): ticker, quantity, market value and weight of each position, has_shorts, and the same book in three shapes: for_analysis (positive weights), for_hedge (positive dollar values) and for_exposure (signed dollars, short < 0). Returns an empty book when no brokerage is linked. Read-only; it does not place orders. Positions are as of the portal's last brokerage sync. Free (no REST charge). No inputs.",
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

  // --- Cross-section ---

  const RANK_METRICS = "subsector_residual, sector_residual, gross_return, mkt_cap, er_l1, er_l2 or er_l3";

  server.registerTool(
    "riskmodels_get_rankings",
    {
      title: "RiskModels Cross-Sectional Rankings",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want one stock's percentile rank within the universe, its sector or its subsector on a risk or return metric. Not for screening the whole universe (use riskmodels_screen_rankings). Returns, from GET /rankings/{ticker}, the stock's rank and percentile for the metric and window. Metrics: " +
        RANK_METRICS +
        ". Windows: 1d, 21d, 63d, 252d. " +
        EOD +
        " Price: $0.005 per call.",
      inputSchema: {
        ticker: tickerParam("NVDA"),
        metric: z.string().optional().describe(`Metric: ${RANK_METRICS}, e.g. subsector_residual`),
        cohort: z.string().optional().describe("Cohort: universe, sector or subsector, e.g. sector"),
        window: z.string().optional().describe("Window in trading days: 1d, 21d, 63d or 252d, e.g. 63d"),
      },
    },
    async ({ ticker, metric, cohort, window }) =>
      run(() => {
        const query: Query = {};
        setIf(query, "metric", metric);
        setIf(query, "cohort", cohort);
        setIf(query, "window", window);
        return sdk.call("GET", `/rankings/${encodeURIComponent(upper(ticker))}`, { query });
      }),
  );

  server.registerTool(
    "riskmodels_screen_rankings",
    {
      title: "RiskModels Rankings Screen",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want the names in the universe that rank highest or lowest on one metric, with optional percentile, decile and sector filters. Not for one stock's rank (use riskmodels_get_rankings). Returns, from POST /rankings/screen, the ranked rows that pass the filters; metrics, cohorts and windows are the same as for one stock's rank. " +
        EOD +
        " Price: $0.25 per call.",
      inputSchema: {
        metric: z.string().min(1).describe(`Metric: ${RANK_METRICS}, e.g. er_l3`),
        cohort: z.string().min(1).describe("Cohort: universe, sector or subsector, e.g. universe"),
        window: z.string().min(1).describe("Window in trading days: 1d, 21d, 63d or 252d, e.g. 21d"),
        as_of: isoDate("Ranking date (default latest)", "2026-06-30"),
        min_percentile: z.number().optional().describe("Minimum percentile, 0-100, e.g. 90"),
        decile: z.number().int().optional().describe("Restrict to one decile, integer 1-10, e.g. 10"),
        sector_filter: z.string().optional().describe("Restrict to one sector, by sector ETF ticker, e.g. XLK"),
        limit: z.number().int().optional().describe("Maximum rows, integer, e.g. 25 (default 100)"),
      },
    },
    async ({ metric, cohort, window, as_of, min_percentile, decile, sector_filter, limit }) =>
      run(() => {
        const body: Record<string, unknown> = { metric, cohort, window };
        setIf(body, "as_of", as_of);
        setIf(body, "min_percentile", min_percentile);
        setIf(body, "decile", decile);
        setIf(body, "sector_filter", sector_filter);
        setIf(body, "limit", limit);
        return sdk.call("POST", "/rankings/screen", { body });
      }),
  );

  server.registerTool(
    "riskmodels_get_cohorts",
    {
      title: "RiskModels Cohort Statistics",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want cross-sectional residual statistics for SPY and the 11 GICS sector SPDR cohorts, on one date or as a time series. Not for one stock's peers (use riskmodels_get_peers) or one stock's rank (use riskmodels_get_rankings). Returns, from GET /cohorts (one date) or GET /cohorts/series (series=true), residual_mean, residual_sd, mean_pairwise_corr, n_names and n_effective by default, more on request. ERM3 residuals are fitted without an intercept, so residual_mean is not zero; link_fit_resid_sd is the OLS standard error of linked_beta on the 252-day window's common sample (n - 2 degrees of freedom). Subsector cohorts are not available. " +
        EOD +
        " Price: $0.04 for one date, $0.15 for a series.",
      inputSchema: {
        cohorts: z
          .string()
          .optional()
          .describe('Comma-separated cohort tickers from SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE, e.g. "SPY,XLK" (default all)'),
        variables: z
          .string()
          .optional()
          .describe('Comma-separated variables, e.g. "residual_sd,n_names" (default residual_mean, residual_sd, mean_pairwise_corr, n_names, n_effective)'),
        series: z
          .boolean()
          .optional()
          .describe("true returns a time series over start_date..end_date, e.g. true (default false: one date)"),
        teo: isoDate("Observation date for the one-date view (default latest)", "2026-06-30"),
        start_date: isoDate("Series start, series=true only", "2025-01-02"),
        end_date: isoDate("Series end, series=true only", "2026-06-30"),
        min_names: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Drop cohorts or days with fewer members, integer, e.g. 20"),
      },
    },
    async ({ cohorts, variables, series, teo, start_date, end_date, min_names }) =>
      run(() => {
        const query: Query = {};
        setIf(query, "cohorts", cohorts);
        setIf(query, "variables", variables);
        setIf(query, "min_names", min_names);
        if (series) {
          setIf(query, "start_date", start_date);
          setIf(query, "end_date", end_date);
          return sdk.call("GET", "/cohorts/series", { query });
        }
        setIf(query, "teo", teo);
        return sdk.call("GET", "/cohorts", { query });
      }),
  );

  server.registerTool(
    "riskmodels_get_peers",
    {
      title: "RiskModels Peer Group",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want the stocks that share a stock's subsector ETF or sector ETF. Not for cohort-level residual statistics (use riskmodels_get_cohorts). Returns, from GET /peers, the peer list ordered by market cap with each peer's market cap. " +
        EOD +
        " Price: $0.005 per call.",
      inputSchema: {
        ticker: tickerParam("NVDA"),
        group_by: z
          .enum(["subsector_etf", "sector_etf"])
          .optional()
          .describe("Peer grouping, e.g. sector_etf (default subsector_etf)"),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum peers, integer 1-200, e.g. 20 (default 50)"),
      },
    },
    async ({ ticker, group_by, limit }) =>
      run(() => {
        const query: Query = { ticker: upper(ticker) };
        setIf(query, "group_by", group_by);
        setIf(query, "limit", limit);
        return sdk.call("GET", "/peers", { query });
      }),
  );

  // --- Entities ---

  server.registerTool(
    "riskmodels_search",
    {
      title: "RiskModels Search",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need to resolve a name or fragment to an identifier: a stock ticker, an ETF ticker, a mutual fund's bw_fund_id or a 13F filer's bw_filer_id. Not for data about the match (use riskmodels_get_stock_snapshot, riskmodels_get_etf, riskmodels_get_fund or riskmodels_get_filer). Returns matches from GET /tickers (type stock), GET /data/etf/search (etf: each hit carries capabilities cascade, priced and holdings, i.e. hedge leg, daily returns and look-through holdings), GET /funds/search (fund: bw_fund_id, ticker, name, style box, asset class, total assets) or GET /13f/filers/search (filer: bw_filer_id). Registry refreshed end-of-day. Free.",
      inputSchema: {
        type: z
          .enum(["stock", "etf", "fund", "filer"])
          .optional()
          .describe("What to search for, e.g. filer (default stock)"),
        q: z
          .string()
          .optional()
          .describe('Symbol or name fragment, e.g. "nvidia", "SMH", "contrafund" or "berkshire"; required for type filer'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum matches, integer, e.g. 10 (default 25 for etf and filer, 50 for fund; max 100, fund 500; ignored for stock)"),
        mag7: z.boolean().optional().describe("type stock only: true returns the seven largest US technology names, e.g. true"),
        include_metadata: z.boolean().optional().describe("type stock only: true adds sector and company metadata per match, e.g. true"),
        equity_style_9box: z
          .string()
          .optional()
          .describe('type fund only: style box slug or name, e.g. "large-growth" or "Large Growth"'),
        primary: z.boolean().optional().describe("type fund only: true returns share-class primaries only, e.g. true"),
        include_inactive: z
          .boolean()
          .optional()
          .describe("type fund only: true also returns funds without a recent holdings report, e.g. true (default false)"),
        include_etfs: z.boolean().optional().describe("type fund only: false drops funds flagged as ETFs, e.g. false (default true)"),
      },
    },
    async ({ type, q, limit, mag7, include_metadata, equity_style_9box, primary, include_inactive, include_etfs }) => {
      const kind = type ?? "stock";
      const query: Query = {};
      if (kind === "stock") {
        setIf(query, "search", q);
        setIf(query, "mag7", mag7);
        setIf(query, "include_metadata", include_metadata);
        return run(() => sdk.call("GET", "/tickers", { query }));
      }
      if (kind === "fund") {
        setIf(query, "q", q);
        setIf(query, "equity_style_9box", equity_style_9box);
        setIf(query, "primary", primary);
        setIf(query, "limit", limit);
        setIf(query, "include_inactive", include_inactive);
        setIf(query, "include_etfs", include_etfs);
        return run(() => sdk.call("GET", "/funds/search", { query }));
      }
      if (limit !== undefined && limit > 100) {
        return toolErrorResult({ error: `limit for type ${kind} is 1-100.` });
      }
      if (kind === "filer") {
        if (!q || !q.trim()) return toolErrorResult({ error: "q is required for type filer." });
        query.q = q;
        setIf(query, "limit", limit);
        return run(() => sdk.call("GET", "/13f/filers/search", { query }));
      }
      setIf(query, "q", q);
      setIf(query, "limit", limit);
      return run(() => sdk.call("GET", "/data/etf/search", { query }));
    },
  );

  server.registerTool(
    "riskmodels_resolve_security_identity",
    {
      title: "RiskModels Security Identity",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when a ticker or holding must be pinned to the security it meant on a past date, or carried forward to what it became: a reused ticker (FB today is an ETF, not Meta; BBBY in 2020 and 2026 are different companies), a ticker change, an ADR conversion with its ratio, a split, a spin-off or distribution that adds a second security, a cash merger with no equity successor, or a bankruptcy cancellation. Not for current risk or returns (use riskmodels_get_stock_snapshot or riskmodels_decompose) and not for name search (use riskmodels_search). Returns, from GET /identity/resolve, status (resolved, ambiguous, unavailable or unsupported), coverage (reviewed only when every step comes from SEC-cited reviewed corporate-action events; inferred when it rests on ticker aliases or the security master; unknown otherwise), the identity with candidates and any duplicate or excluded records, the resulting holdings with exact quantities, cash including cash in lieu of fractional shares, no_equity_successor, every applied event with its dates and SEC filing link, and an explanation. An identifier it cannot place returns unavailable or ambiguous rather than a guess. Reviewed coverage is limited and growing. Free.",
      inputSchema: {
        identifier: z
          .string()
          .min(1)
          .max(40)
          .describe('Ticker as written on the record, or a bw_sym_id, e.g. "BBBY" or "BW-BBG000BSJK37"'),
        as_of: isoDate("Date to carry the holding to, or to identify the ticker on when acquired_on is absent", "2026-10-16"),
        acquired_on: isoDate("Date the position was acquired; set it to carry the holding forward through corporate actions", "2020-01-02"),
        quantity: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe('Units held on acquired_on, decimal string, e.g. "100" (default 100)'),
        identifier_type: z
          .enum(["ticker", "bw_sym_id"])
          .optional()
          .describe("How to read identifier, e.g. ticker (default: bw_sym_id when it starts with BW-)"),
        known_as_of: isoDate("Reproduce the answer as it stood on this date, ignoring events learned later", "2026-10-18"),
        fractions: z
          .enum(["apply", "exact"])
          .optional()
          .describe("apply honours cash in lieu and rounding; exact returns the raw entitlement, e.g. exact (default apply)"),
      },
    },
    async ({ identifier, as_of, acquired_on, quantity, identifier_type, known_as_of, fractions }) => {
      const query: Query = { identifier: identifier.trim() };
      setIf(query, "as_of", as_of);
      setIf(query, "acquired_on", acquired_on);
      setIf(query, "quantity", quantity);
      setIf(query, "identifier_type", identifier_type);
      setIf(query, "known_as_of", known_as_of);
      setIf(query, "fractions", fractions);
      return run(() => sdk.call("GET", "/identity/resolve", { query }));
    },
  );

  const BW_FILER_ID = z
    .string()
    .min(1)
    .describe("bw_filer_id, e.g. BW-FILER-CIK0001067983, or a composite entity id BW-SYNTH-…");

  const FILER_INCLUDES = ["concentration", "portfolio_history", "metrics"] as const;

  server.registerTool(
    "riskmodels_get_filer",
    {
      title: "RiskModels 13F Filer",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want a 13F filer's profile, latest metrics and concentration, and optionally its largest holdings, a concentration summary, its quarterly portfolio history or its latest metrics row. Not for finding the bw_filer_id (use riskmodels_search) or comparing the book with a benchmark (use riskmodels_get_benchmark_fit). Returns { snapshot, holdings, includes, billing }: snapshot from GET /13f/filers/{bw_filer_id}/snapshot (registry details, latest metrics, concentration), omitted when snapshot is false; holdings, only when holdings_top is set, from GET /13f/filers/{bw_filer_id}/holdings with the source filing's accession_number, filing_type (13F-HR, 13F-HR/A, 13F-NT) and amendment_type (ORIGINAL, RESTATEMENT, NEW_HOLDINGS or UNKNOWN; null on panels published before filing vintages were stored); includes, one block per include value, each the route's own response with its own date fields (end_teo or report_date) or { ok: false, status, error } when that call failed; billing, the list price of each call that succeeded (base_usd, includes_usd, total_usd). Holdings follow the latest 13F filing; metrics use end-of-day prices. Price: $0.05 for the snapshot, plus $0.02 for holdings and $0.02 per include value.",
      inputSchema: {
        bw_filer_id: BW_FILER_ID,
        snapshot: SNAPSHOT_PARAM("filer"),
        holdings_top: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Also return the largest N holdings, integer 1-200, e.g. 25 (default: no holdings)"),
        include: z
          .array(z.enum(FILER_INCLUDES))
          .min(1)
          .max(FILER_INCLUDES.length)
          .optional()
          .describe(
            'Extra data, one GET per value: "concentration" ($0.02): median and latest effective N, top-5 and top-10 weight share and weight HHI over the history window, GET /13f/filers/{bw_filer_id}/concentration; "portfolio_history" ($0.02): quarter-end diagnostics, AUM and style attribution over the history window, GET /13f/filers/{bw_filer_id}/portfolio; "metrics" ($0.02): latest metrics row (diagnostics, AUM, ERM3 coverage, 9-box style attribution), GET /13f/filers/{bw_filer_id}. The window is the last history_months months (default 24), e.g. ["concentration","metrics"]',
          ),
        history_months: HISTORY_MONTHS_PARAM,
      },
    },
    async ({ bw_filer_id, snapshot = true, holdings_top, include, history_months }) => {
      const wanted = [...new Set<string>(include ?? [])];
      if (!snapshot && holdings_top === undefined && wanted.length === 0) {
        return toolErrorResult({
          error: "snapshot=false needs holdings_top or at least one include value (concentration, portfolio_history, metrics).",
        });
      }
      const id = encodeURIComponent(bw_filer_id.trim());
      const window: Query = { start_date: historyStartDate(history_months ?? INCLUDE_HISTORY_MONTHS) };
      const legs: Record<string, EntityLeg> = {
        concentration: { path: `/13f/filers/${id}/concentration`, query: window, usd: 0.02 },
        portfolio_history: { path: `/13f/filers/${id}/portfolio`, query: window, usd: 0.02 },
        metrics: { path: `/13f/filers/${id}`, usd: 0.02 },
      };
      return run(() =>
        entityWithIncludes(
          sdk,
          {
            snapshot: snapshot ? { path: `/13f/filers/${id}/snapshot`, usd: 0.05 } : undefined,
            // The route reads `limit` (top-N, max 1000).
            holdings:
              holdings_top === undefined
                ? undefined
                : { path: `/13f/filers/${id}/holdings`, query: { limit: holdings_top }, usd: 0.02 },
          },
          Object.fromEntries(wanted.map((n) => [n, legs[n]!])),
        ),
      );
    },
  );

  const FUND_INCLUDES = ["hedge", "nav_history", "portfolio_history", "metrics"] as const;

  server.registerTool(
    "riskmodels_get_fund",
    {
      title: "RiskModels Mutual Fund",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want a US mutual fund's profile, return decomposition, hedge ratios and style-box ranks, and optionally its full holdings, latest ETF hedge ratios, NAV history, portfolio return history or latest metrics row. Not for finding the bw_fund_id (use riskmodels_search) or comparing the fund with a benchmark (use riskmodels_get_benchmark_fit). Returns { snapshot, holdings, includes, billing }: snapshot from GET /funds/snapshot/{bw_fund_id} (registry details, latest return decomposition and diagnostics, top 25 holdings, L1/L2/L3 ETF hedge ratios, a 12-month portfolio time series and the fund's rank within its style box on each ranked metric), omitted when snapshot is false; holdings, only when holdings_limit is set, from GET /funds/{bw_fund_id}/holdings (latest filed SEC N-PORT report, ranked by absolute market value, signed weights, long/short/net/gross totals and ticker coverage); includes, one block per include value, each the route's own response with its own date fields (teo, end_teo or report_date) or { ok: false, status, error } when that call failed; billing, the list price of each call that succeeded (base_usd, includes_usd, total_usd). Holdings follow the latest N-PORT filing; metrics use end-of-day prices. Price: $0.05 for the snapshot, plus $0.02 for holdings and $0.02 per include value.",
      inputSchema: {
        bw_fund_id: z.string().min(1).describe("Fund id, e.g. BW-FUND-S000019457"),
        snapshot: SNAPSHOT_PARAM("fund"),
        holdings_limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Also return up to N holdings, integer 1-5000, e.g. 100; 5000 returns the whole book (default: no holdings)"),
        include: z
          .array(z.enum(FUND_INCLUDES))
          .min(1)
          .max(FUND_INCLUDES.length)
          .optional()
          .describe(
            'Extra data, one GET per value: "hedge" ($0.02): latest L1/L2/L3 ETF hedge ratios from the holdings look-through, with teo and the holdings report date behind them, GET /funds/{bw_fund_id}/hedge; "nav_history" ($0.02): month-end NAV close and monthly NAV return over the history window, GET /funds/{bw_fund_id}/nav; "portfolio_history" ($0.02): month-end portfolio return components and diagnostics over the history window, GET /funds/{bw_fund_id}/portfolio; "metrics" ($0.02): latest return decomposition and diagnostics, GET /funds/{bw_fund_id}. The window is the last history_months months (default 24), e.g. ["hedge","nav_history"]',
          ),
        history_months: HISTORY_MONTHS_PARAM,
      },
    },
    async ({ bw_fund_id, snapshot = true, holdings_limit, include, history_months }) => {
      const wanted = [...new Set<string>(include ?? [])];
      if (!snapshot && holdings_limit === undefined && wanted.length === 0) {
        return toolErrorResult({
          error: "snapshot=false needs holdings_limit or at least one include value (hedge, nav_history, portfolio_history, metrics).",
        });
      }
      const id = encodeURIComponent(bw_fund_id.trim());
      const window: Query = { start_date: historyStartDate(history_months ?? INCLUDE_HISTORY_MONTHS) };
      const legs: Record<string, EntityLeg> = {
        hedge: { path: `/funds/${id}/hedge`, usd: 0.02 },
        nav_history: { path: `/funds/${id}/nav`, query: window, usd: 0.02 },
        portfolio_history: { path: `/funds/${id}/portfolio`, query: window, usd: 0.02 },
        metrics: { path: `/funds/${id}`, usd: 0.02 },
      };
      return run(() =>
        entityWithIncludes(
          sdk,
          {
            snapshot: snapshot ? { path: `/funds/snapshot/${id}`, usd: 0.05 } : undefined,
            holdings:
              holdings_limit === undefined
                ? undefined
                : { path: `/funds/${id}/holdings`, query: { limit: holdings_limit }, usd: 0.02 },
          },
          Object.fromEntries(wanted.map((n) => [n, legs[n]!])),
        ),
      );
    },
  );

  server.registerTool(
    "riskmodels_get_etf",
    {
      title: "RiskModels ETF",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want one ETF's registry metadata and portfolio surface, and optionally its largest holdings. Not for finding an ETF ticker (use riskmodels_search) or the ETF's daily returns (use riskmodels_get_returns). Returns { snapshot, holdings }: snapshot from GET /data/etf/{ticker} (every known fund, with capabilities cascade = hedge leg in the SPY/sector/subsector cascade, priced = daily returns and beta to SPY since priced_from, holdings = look-through as of holdings_as_of, plus factor_role and FIGI/CIK/BW identifiers), omitted when snapshot is false; holdings, only when holdings_top is set, from GET /data/etf/{ticker}/holdings. Holdings follow the latest published holdings file; registry refreshed end-of-day. Free (no per-call charge).",
      inputSchema: {
        ticker: z.string().min(1).describe("ETF ticker symbol, case-insensitive, e.g. SMH"),
        snapshot: z
          .boolean()
          .optional()
          .describe("Also fetch the ETF snapshot, e.g. false for holdings only (default true; false needs holdings_top)"),
        holdings_top: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Also return the largest N holdings, integer 1-200, e.g. 25 (default: no holdings)"),
      },
    },
    async ({ ticker, snapshot = true, holdings_top }) => {
      if (!snapshot && holdings_top === undefined) {
        return toolErrorResult({ error: "snapshot=false needs holdings_top." });
      }
      return run(async () => {
        const t = encodeURIComponent(upper(ticker));
        const out: Record<string, unknown> = {};
        if (snapshot) out.snapshot = await sdk.call("GET", `/data/etf/${t}`);
        if (holdings_top !== undefined) {
          out.holdings = await sdk.call("GET", `/data/etf/${t}/holdings`, { query: { top: holdings_top } });
        }
        return out;
      });
    },
  );

  server.registerTool(
    "riskmodels_get_benchmark_fit",
    {
      title: "RiskModels Benchmark Fit (active weights)",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you want to compare a fund, 13F filer or ETF portfolio with a benchmark: active share and the largest active weights. Not for the subject's own holdings (use riskmodels_get_fund, riskmodels_get_filer or riskmodels_get_etf). Returns, from GET /data/benchmark-fit, active share, active-weight RMS (a coarse tracking-error proxy), overlap, and the largest over- and underweights at a common date. Benchmarks: ff_own (free-float-cap weights of the subject's own holdings), the large and small style cells (cell_large-value, cell_large-blend, cell_large-growth, cell_small-value, cell_small-blend, cell_small-growth), or all (every available benchmark for the subject). Holdings dates follow the latest filings; weights use end-of-day prices. Price: $0.02 per call.",
      inputSchema: {
        subject: z
          .string()
          .min(1)
          .describe("BW-* portfolio id (BW-FUND-…, BW-FILER-…, BW-ETF-…) or an ETF ticker, e.g. BW-FUND-S000019457 or SPY"),
        benchmark: z
          .enum(LIVE_FIT_BENCHMARKS)
          .describe("ff_own, a large or small style cell, or all, e.g. cell_large-growth"),
        as_of: isoDate("Upper bound on the subject's holdings date; the benchmark is taken at its latest date on or before it", "2026-03-31"),
        top: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of over- and underweights, integer 1-100, e.g. 20 (default 10)"),
      },
    },
    async ({ subject, benchmark, as_of, top }) =>
      run(() => {
        const query: Query = { subject: subject.trim(), benchmark: benchmark.trim() };
        setIf(query, "as_of", as_of);
        setIf(query, "top", top);
        return sdk.call("GET", "/data/benchmark-fit", { query });
      }),
  );

  server.registerTool(
    "riskmodels_get_factor_returns",
    {
      title: "RiskModels Macro and Sector ETF Factor Returns",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      description:
        "Use when you need macro factor return series (inflation, term spread, short rates, credit, oil, gold, the dollar, volatility, bitcoin, VIX) or the trailing returns of SPY and the 11 GICS sector SPDR ETFs. Not for a stock's correlation with those factors (use riskmodels_get_macro_correlation) or one ETF's daily return series (use riskmodels_get_returns). kind macro returns daily total returns over a date range (GET /macro-factors); kind sector_etf returns closing price and trailing 1, 21, 63 and 252-day total returns on one date (GET /etf/factor-returns). " +
        EOD +
        " Price: $0.005 per call (macro) or $0.02 per call (sector_etf).",
      inputSchema: {
        kind: z
          .enum(["macro", "sector_etf"])
          .describe("macro: daily macro factor returns over a range; sector_etf: SPY and sector SPDR returns on one date, e.g. macro"),
        factors: z
          .string()
          .optional()
          .describe(
            'kind macro only: comma-separated keys from inflation, term_spread, short_rates, credit, oil, gold, usd, volatility, bitcoin, vix_spot, e.g. "oil,gold,usd" (default all ten)',
          ),
        start: isoDate("kind macro only: first date, inclusive (default five years before end)", "2021-01-04"),
        end: isoDate("kind macro only: last date, inclusive (default today)", "2026-06-30"),
        sleeve: z
          .enum(["market", "sector", "all"])
          .optional()
          .describe("kind sector_etf only: market (SPY), sector (11 sector SPDRs) or all, e.g. sector (default all)"),
        tickers: z
          .string()
          .optional()
          .describe('kind sector_etf only: comma-separated subset of SPY, XLE, XLB, XLI, XLY, XLP, XLV, XLF, XLK, XLC, XLU, XLRE, e.g. "XLK,XLF"'),
        teo: isoDate("kind sector_etf only: observation date (default latest)", "2026-06-30"),
      },
    },
    async ({ kind, factors, start, end, sleeve, tickers, teo }) =>
      run(() => {
        const query: Query = {};
        if (kind === "sector_etf") {
          setIf(query, "sleeve", sleeve);
          setIf(query, "tickers", tickers);
          setIf(query, "teo", teo);
          return sdk.call("GET", "/etf/factor-returns", { query });
        }
        setIf(query, "factors", factors);
        setIf(query, "start", start);
        setIf(query, "end", end);
        return sdk.call("GET", "/macro-factors", { query });
      }),
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

Then run the four live examples:
1. riskmodels_compare with tickers ["AAPL","NVDA"]
2. riskmodels_compare with tickers ["AAPL","NVDA","CRWD"]
3. riskmodels_decompose with ticker "NVDA" and dollars 10000
4. riskmodels_get_portfolio_risk_snapshot with positions [{"ticker":"AAPL","weight":0.4},{"ticker":"NVDA","weight":0.35},{"ticker":"CRWD","weight":0.25}]`),
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
        `Use riskmodels_decompose with ticker ${ticker || "NVDA"} and dollars ${dollars || "10000"} to hedge a $${dollars || "10000"} ${ticker || "NVDA"} position. Explain the ETF legs.`,
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
        `Call riskmodels_get_my_positions first. If it returns a book with has_shorts true or more than 100 names, pass for_exposure to riskmodels_portfolio_exposure. Otherwise pass for_hedge to riskmodels_analyze_portfolio for the hedge levels and ETF hedge notionals. If the book is empty, ask for tickers and weights or dollar notionals, then call riskmodels_analyze_portfolio, or riskmodels_get_portfolio_risk_snapshot for a variance decomposition, or riskmodels_portfolio_exposure with signed dollar values if any position is short. Explain the layers. Do not place orders.`,
      ),
  );
}
