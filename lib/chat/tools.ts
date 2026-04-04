/**
 * Declarative chat tool registry: OpenAI schemas, Zod args, DAL executors, sanitizers.
 * search_tickers is free (capabilityId: null) — matches public GET /api/tickers (no billing).
 */

import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { TickerSchema, YearsSchema } from "@/lib/api/schemas";
import { parseMacroFactorsSeriesQuery } from "@/lib/api/macro-factors-series-query";
import { searchTickers } from "@/lib/dal/ticker-search";
import { fetchMacroFactorSeriesRows } from "@/lib/dal/macro-factors";
import {
  resolveSymbolByTicker,
  fetchLatestMetrics,
  fetchHistory,
  pivotHistory,
  fetchRankingsFromSecurityHistory,
} from "@/lib/dal/risk-engine-v3";
import { getL3DecompositionService } from "@/lib/risk/l3-decomposition-service";
import {
  computeFactorCorrelation,
  DEFAULT_MACRO_FACTORS,
} from "@/lib/risk/factor-correlation-service";
import { normalizeMacroFactorKeys } from "@/lib/risk/macro-factor-keys";
import { runPortfolioRiskComputation } from "@/lib/portfolio/portfolio-risk-core";
import {
  applyLargeResultFallback,
  sanitizeMacroFactorSeries,
  sanitizePortfolioRiskIndexResult,
  truncateRowsWithSummary,
} from "@/lib/chat/utils";

function fnTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  required: string[],
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      strict: true,
      parameters: {
        type: "object",
        properties: parameters,
        required,
        additionalProperties: false,
      },
    },
  } as ChatCompletionTool;
}

const getRiskMetricsArgs = z.object({
  ticker: TickerSchema,
});

const getL3Args = z.object({
  ticker: TickerSchema,
  market_factor_etf: z.string().min(1).default("SPY"),
});

const getTickerReturnsArgs = z.object({
  ticker: TickerSchema,
  years: YearsSchema,
});

const getRankingsArgs = z.object({
  ticker: TickerSchema,
});

const factorCorrelationArgs = z.object({
  ticker: TickerSchema,
  factors: z.array(z.string().min(1)).default([]),
  return_type: z.enum(["gross", "l1", "l2", "l3_residual"]).default("l3_residual"),
  window_days: z.coerce.number().int().min(20).max(2000).default(252),
  method: z.enum(["pearson", "spearman"]).default("pearson"),
});

const macroFactorsArgs = z.object({
  factors: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
});

const searchTickersArgs = z.object({
  search: z.string().min(1, "Search query is required"),
  include_metadata: z.boolean().default(true),
});

const portfolioRiskArgs = z.object({
  positions: z
    .array(
      z.object({
        ticker: TickerSchema,
        weight: z.coerce.number(),
      }),
    )
    .min(1, "At least one position is required")
    .max(100),
  timeSeries: z.boolean().default(false),
  years: YearsSchema,
});

async function execGetRiskMetrics(args: z.infer<typeof getRiskMetricsArgs>) {
  const { ticker } = args;
  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) {
    throw new Error(`Symbol not found for ticker ${ticker}`);
  }
  const latestData = await fetchLatestMetrics(
    symbolRecord.symbol,
    [
      "vol_23d",
      "price_close",
      "market_cap",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l3_res_er",
    ],
    "daily",
  );
  if (!latestData) {
    throw new Error("No metrics found");
  }
  return {
    symbol: symbolRecord.symbol,
    ticker: symbolRecord.ticker,
    teo: latestData.teo,
    periodicity: "daily",
    metrics: {
      vol_23d: latestData.metrics.vol_23d ?? null,
      price_close: latestData.metrics.price_close ?? null,
      market_cap: latestData.metrics.market_cap ?? null,
      l3_mkt_hr: latestData.metrics.l3_mkt_hr ?? null,
      l3_sec_hr: latestData.metrics.l3_sec_hr ?? null,
      l3_sub_hr: latestData.metrics.l3_sub_hr ?? null,
      l3_mkt_er: latestData.metrics.l3_mkt_er ?? null,
      l3_sec_er: latestData.metrics.l3_sec_er ?? null,
      l3_sub_er: latestData.metrics.l3_sub_er ?? null,
      l3_res_er: latestData.metrics.l3_res_er ?? null,
    },
    meta: {
      sector_etf: symbolRecord.sector_etf || null,
      asset_type: symbolRecord.asset_type || null,
    },
  };
}

async function execGetL3(args: z.infer<typeof getL3Args>) {
  const svc = getL3DecompositionService();
  const out = await svc.getDecomposition(args.ticker, args.market_factor_etf);
  if (!out) {
    throw new Error(`No L3 decomposition for ${args.ticker}`);
  }
  return out;
}

async function execGetTickerReturns(args: z.infer<typeof getTickerReturnsArgs>) {
  const { ticker, years } = args;
  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) {
    throw new Error(`Ticker not found: ${ticker}`);
  }
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);
  const startDateStr = startDate.toISOString().split("T")[0];
  const rows = await fetchHistory(
    symbolRecord.symbol,
    [
      "returns_gross",
      "price_close",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l3_res_er",
    ],
    {
      periodicity: "daily",
      startDate: startDateStr,
      orderBy: "asc",
    },
  );
  const pivoted = pivotHistory(rows);
  const data = pivoted.map((row) => ({
    date: row.teo,
    returns_gross: row.returns_gross ?? null,
    price_close: row.price_close ?? null,
    l3_mkt_hr: row.l3_mkt_hr ?? null,
    l3_sec_hr: row.l3_sec_hr ?? null,
    l3_sub_hr: row.l3_sub_hr ?? null,
    l3_mkt_er: row.l3_mkt_er ?? null,
    l3_sec_er: row.l3_sec_er ?? null,
    l3_sub_er: row.l3_sub_er ?? null,
    l3_res_er: row.l3_res_er ?? null,
  }));
  return {
    symbol: symbolRecord.symbol,
    ticker: symbolRecord.ticker,
    periodicity: "daily",
    years,
    data,
  };
}

async function execGetRankings(args: z.infer<typeof getRankingsArgs>) {
  const symbolRecord = await resolveSymbolByTicker(args.ticker);
  if (!symbolRecord) {
    throw new Error(`Symbol not found for ticker ${args.ticker}`);
  }
  const { teo, rankings } = await fetchRankingsFromSecurityHistory(symbolRecord.symbol, undefined);
  return {
    ticker: symbolRecord.ticker,
    symbol: symbolRecord.symbol,
    teo,
    rankings,
  };
}

async function execFactorCorrelation(args: z.infer<typeof factorCorrelationArgs>) {
  const factorList = args.factors.length ? args.factors : [...DEFAULT_MACRO_FACTORS];
  const { keys, warnings } = normalizeMacroFactorKeys(factorList);
  if (keys.length === 0) {
    throw new Error(
      warnings[0] ??
        `No valid macro factors; use one of: ${DEFAULT_MACRO_FACTORS.join(", ")}`,
    );
  }
  const result = await computeFactorCorrelation({
    ticker: args.ticker,
    factors: keys.map(String),
    return_type: args.return_type,
    window_days: args.window_days,
    method: args.method,
  });
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    throw new Error(String((result as { error: string }).error));
  }
  return result;
}

async function execMacroFactors(args: z.infer<typeof macroFactorsArgs>) {
  const sp = new URLSearchParams();
  if (args.factors.trim()) sp.set("factors", args.factors.trim());
  if (args.start.trim()) sp.set("start", args.start.trim());
  if (args.end.trim()) sp.set("end", args.end.trim());
  const parsed = parseMacroFactorsSeriesQuery(sp);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const { rows, warnings, factors_requested } = await fetchMacroFactorSeriesRows(
    parsed.factorStrings,
    parsed.start,
    parsed.end,
  );
  return {
    factors_requested,
    start: parsed.start,
    end: parsed.end,
    row_count: rows.length,
    warnings,
    series: rows,
  };
}

async function execSearchTickers(args: z.infer<typeof searchTickersArgs>) {
  return searchTickers(args.search, args.include_metadata);
}

function sanitizeL3DecompositionResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const o = result as Record<string, unknown> & { dates?: string[] };
  const dates = o.dates;
  if (!Array.isArray(dates) || dates.length <= 120) {
    return applyLargeResultFallback(result);
  }
  const n = dates.length;
  const headN = 40;
  const tailN = 40;
  const headIdx = [...Array(headN).keys()];
  const tailIdx = [...Array(tailN).keys()].map((i) => n - tailN + i);
  const sliceSeries = (arr: unknown): { head: unknown[]; tail: unknown[]; length: number } => {
    const a = Array.isArray(arr) ? arr : [];
    return {
      head: headIdx.map((i) => a[i]),
      tail: tailIdx.map((i) => a[i]),
      length: a.length,
    };
  };
  return applyLargeResultFallback({
    ticker: o.ticker,
    market_factor_etf: o.market_factor_etf,
    universe: o.universe,
    data_source: o.data_source,
    truncated: true,
    dates: sliceSeries(dates),
    l3_mkt_hr: sliceSeries(o.l3_mkt_hr),
    l3_sec_hr: sliceSeries(o.l3_sec_hr),
    l3_sub_hr: sliceSeries(o.l3_sub_hr),
    l3_mkt_er: sliceSeries(o.l3_mkt_er),
    l3_sec_er: sliceSeries(o.l3_sec_er),
    l3_sub_er: sliceSeries(o.l3_sub_er),
    l3_res_er: sliceSeries(o.l3_res_er),
  });
}

async function execPortfolioRisk(args: z.infer<typeof portfolioRiskArgs>) {
  const core = await runPortfolioRiskComputation(args.positions, {
    timeSeries: args.timeSeries,
    years: args.years,
    includeHedgeRatios: false,
  });
  if (core.status === "syncing") {
    return {
      status: "syncing",
      message:
        "No positions resolved or empty portfolio state. Check tickers and weights.",
    };
  }
  if (core.status === "invalid") {
    throw new Error(
      `No valid positions: ${core.errors.map((e) => `${e.ticker}: ${e.error}`).join("; ")}`,
    );
  }
  const portfolioER = core.portfolioER;
  const systematic = core.systematic;
  const body: Record<string, unknown> = {
    portfolio_risk_index: {
      variance_decomposition: {
        market: portfolioER.market,
        sector: portfolioER.sector,
        subsector: portfolioER.subsector,
        residual: portfolioER.residual,
        systematic,
      },
      portfolio_volatility_23d: core.portfolioVol,
      position_count: core.summary.resolved,
    },
    per_ticker: core.perTicker,
    summary: {
      total_positions: core.summary.total_positions,
      resolved: core.summary.resolved,
      errors: core.summary.errors,
    },
  };
  if (core.errorsList.length > 0) {
    body.errors = core.errorsList;
  }
  if (core.timeSeriesData) {
    body.time_series = core.timeSeriesData;
  }
  return body;
}

export interface ChatToolDef {
  /** Stable tool name (OpenAI function name) */
  name: string;
  openaiTool: ChatCompletionTool;
  /** null = free tool (no deductBalance), e.g. search_tickers */
  capabilityId: string | null;
  argSchema: z.ZodSchema;
  executor: (args: unknown) => Promise<unknown>;
  sanitizer?: (result: unknown) => unknown;
}

export const CHAT_TOOLS_REGISTRY: ChatToolDef[] = [
  {
    name: "get_risk_metrics",
    openaiTool: fnTool(
      "get_risk_metrics",
      "Latest hedge ratios (L3), explained risk, volatility, and price for a US equity ticker. Use for current snapshot (e.g. NVDA, AAPL).",
      {
        ticker: {
          type: "string",
          description: "US stock ticker symbol, e.g. NVDA, AAPL, MSFT, TSLA",
        },
      },
      ["ticker"],
    ),
    capabilityId: "metrics-snapshot",
    argSchema: getRiskMetricsArgs,
    executor: async (a) => execGetRiskMetrics(getRiskMetricsArgs.parse(a)),
  },
  {
    name: "get_l3_decomposition",
    openaiTool: fnTool(
      "get_l3_decomposition",
      "Full time series of L3 hedge ratios and explained risk (market, sector, subsector, residual) for one ticker.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker, e.g. NVDA, AAPL",
        },
        market_factor_etf: {
          type: "string",
          description: "Market factor ETF ticker, default SPY",
        },
      },
      ["ticker", "market_factor_etf"],
    ),
    capabilityId: "l3-decomposition",
    argSchema: getL3Args,
    executor: async (a) => execGetL3(getL3Args.parse(a)),
    sanitizer: sanitizeL3DecompositionResult,
  },
  {
    name: "get_ticker_returns",
    openaiTool: fnTool(
      "get_ticker_returns",
      "Daily returns and L3 hedge ratios / ER over time. Use for how metrics changed over 1–15 years.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker, e.g. NVDA, AAPL",
        },
        years: {
          type: "integer",
          description: "Years of daily history, 1–15; default 1",
        },
      },
      ["ticker", "years"],
    ),
    capabilityId: "ticker-returns",
    argSchema: getTickerReturnsArgs,
    executor: async (a) => execGetTickerReturns(getTickerReturnsArgs.parse(a)),
    sanitizer: (r) => {
      if (!r || typeof r !== "object") return r;
      const o = r as Record<string, unknown>;
      const data = o.data;
      if (!Array.isArray(data)) return applyLargeResultFallback(r);
      const sanitized = {
        ...o,
        data: truncateRowsWithSummary(data as Record<string, unknown>[], {
          maxRows: 50,
          tailRows: 10,
          includeSummary: true,
        }),
      };
      return applyLargeResultFallback(sanitized);
    },
  },
  {
    name: "get_rankings",
    openaiTool: fnTool(
      "get_rankings",
      "Cross-sectional percentile rankings for a ticker (sector/universe). rank_percentile 100 = best.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker, e.g. NVDA",
        },
      },
      ["ticker"],
    ),
    capabilityId: "rankings",
    argSchema: getRankingsArgs,
    executor: async (a) => execGetRankings(getRankingsArgs.parse(a)),
    sanitizer: (r) => applyLargeResultFallback(r),
  },
  {
    name: "get_factor_correlation",
    openaiTool: fnTool(
      "get_factor_correlation",
      "Correlation of stock returns vs macro factors (bitcoin, gold, oil, dxy, vix, ust10y2y).",
      {
        ticker: {
          type: "string",
          description: "US stock ticker, e.g. NVDA",
        },
        factors: {
          type: "array",
          items: { type: "string" },
          description: "Macro factor keys; empty array = all six defaults",
        },
        return_type: {
          type: "string",
          enum: ["gross", "l1", "l2", "l3_residual"],
          description: "Return series to correlate; default l3_residual",
        },
        window_days: {
          type: "integer",
          description: "Trailing window length, 20–2000; default 252",
        },
        method: {
          type: "string",
          enum: ["pearson", "spearman"],
          description: "Correlation method; default pearson",
        },
      },
      ["ticker", "factors", "return_type", "window_days", "method"],
    ),
    capabilityId: "factor-correlation",
    argSchema: factorCorrelationArgs,
    executor: async (a) => execFactorCorrelation(factorCorrelationArgs.parse(a)),
  },
  {
    name: "get_macro_factors",
    openaiTool: fnTool(
      "get_macro_factors",
      "Daily macro factor total returns (no stock ticker). Factors: bitcoin, gold, oil, dxy, vix, ust10y2y.",
      {
        factors: {
          type: "string",
          description:
            "Comma-separated factor keys, or empty string for all six canonical factors",
        },
        start: {
          type: "string",
          description: "Start date YYYY-MM-DD, or empty for API default (5y before end)",
        },
        end: {
          type: "string",
          description: "End date YYYY-MM-DD, or empty for today (UTC)",
        },
      },
      ["factors", "start", "end"],
    ),
    capabilityId: "macro-factor-series",
    argSchema: macroFactorsArgs,
    executor: async (a) => execMacroFactors(macroFactorsArgs.parse(a)),
    sanitizer: (r) => {
      if (!r || typeof r !== "object") return r;
      const o = r as Record<string, unknown>;
      const series = o.series;
      if (!Array.isArray(series)) return applyLargeResultFallback(r);
      return applyLargeResultFallback({
        ...o,
        series: sanitizeMacroFactorSeries(series as Record<string, unknown>[], {
          valueKeys: ["return_gross"],
        }),
      });
    },
  },
  {
    name: "search_tickers",
    openaiTool: fnTool(
      "search_tickers",
      "Resolve company name or partial symbol to tickers (free lookup). Use before other tools if the user gave a company name.",
      {
        search: {
          type: "string",
          description: "Company name or ticker fragment, e.g. Apple, NVDA, Tesla",
        },
        include_metadata: {
          type: "boolean",
          description: "Include company name and sector when true",
        },
      },
      ["search", "include_metadata"],
    ),
    /** Free: matches public /api/tickers search (no billing). */
    capabilityId: null,
    argSchema: searchTickersArgs,
    executor: async (a) => execSearchTickers(searchTickersArgs.parse(a)),
  },
  {
    name: "compute_portfolio_risk_index",
    openaiTool: fnTool(
      "compute_portfolio_risk_index",
      "Portfolio Risk Index — weighted L3 explained risk and portfolio volatility. Use for multi-ticker portfolios.",
      {
        positions: {
          type: "array",
          description: "Holdings as { ticker, weight }; weights should sum to ~1",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "e.g. NVDA" },
              weight: { type: "number", description: "Portfolio weight, e.g. 0.25" },
            },
            required: ["ticker", "weight"],
            additionalProperties: false,
          },
        },
        timeSeries: {
          type: "boolean",
          description: "If true, include PRI time series (larger payload)",
        },
        years: {
          type: "integer",
          description: "Years of history when timeSeries true; 1–15, default 1",
        },
      },
      ["positions", "timeSeries", "years"],
    ),
    capabilityId: "portfolio-risk-index",
    argSchema: portfolioRiskArgs,
    executor: async (a) => execPortfolioRisk(portfolioRiskArgs.parse(a)),
    sanitizer: (r) => applyLargeResultFallback(sanitizePortfolioRiskIndexResult(r)),
  },
];

export const CHAT_TOOLS = CHAT_TOOLS_REGISTRY.map((t) => t.openaiTool);

export const TOOL_MAP: Record<string, ChatToolDef> = Object.fromEntries(
  CHAT_TOOLS_REGISTRY.map((t) => [t.name, t]),
);

export const TOOL_CAPABILITY_MAP: Record<string, string | null> = Object.fromEntries(
  CHAT_TOOLS_REGISTRY.map((t) => [t.name, t.capabilityId]),
);

/** One-line hints for system prompt */
export function getChatToolReminderLines(): string[] {
  return CHAT_TOOLS_REGISTRY.map((t) => {
    const tool = t.openaiTool as Extract<ChatCompletionTool, { type: "function" }>;
    const desc = tool.function?.description?.split(".")[0] ?? "";
    return `- ${t.name}: ${desc}`;
  });
}
