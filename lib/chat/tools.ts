/**
 * Declarative chat tool registry: OpenAI schemas, Zod args, DAL executors, sanitizers.
 * search_tickers is free (capabilityId: null) — matches public GET /api/tickers (no billing).
 */

import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { TickerSchema, YearsSchema } from "@/lib/api/schemas";
import { parseMacroFactorsSeriesQuery } from "@/lib/api/macro-factors-series-query";
import { searchTickers } from "@/lib/dal/ticker-search";
import { searchFunds, fetchFund } from "@/lib/dal/funds-engine";
import { searchFilers, fetchFiler } from "@/lib/dal/filers-engine";
import {
  readFundHoldingsTopN,
  readFilerHoldingsTopN,
} from "@/lib/dal/funds-zarr-reader";
import { fetchMacroFactorSeriesRows } from "@/lib/dal/macro-factors";
import {
  resolveSymbolByTicker,
  fetchLatestMetrics,
  fetchLatestMetricsWithFallback,
  fetchHistory,
  pivotHistory,
  fetchRankingsFromSecurityHistory,
} from "@/lib/dal/risk-engine-v3";
import { readLatestLinkBetas } from "@/lib/dal/zarr-reader";
import {
  buildHedgeBasket,
  isValidUserSegment,
} from "@/lib/risk/hedge-recommendation-service";
import { DEFAULT_USER_SEGMENT } from "@/lib/dal/hedge-recommendation";
import { getL3DecompositionService } from "@/lib/risk/l3-decomposition-service";
import { getResidualSignalForTicker } from "@/lib/risk/residual-signal-service";
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
import {
  renderArtifact,
  WIRED_ARTIFACT_RENDER_MATRIX,
} from "@/lib/artifacts/render-client";

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

const getResidualSignalArgs = z.object({
  ticker: TickerSchema,
});

const getHedgeBasketArgs = z.object({
  ticker: TickerSchema,
  user_segment: z
    .enum(["retail", "family_office", "ls_equity", "stat_arb"])
    .default("family_office"),
});

const getL3Args = z.object({
  ticker: TickerSchema,
  market_factor_etf: z.string().min(1).default("SPY"),
  years: YearsSchema,
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

const searchFundsArgs = z.object({
  query: z.string().min(1, "Fund ticker or name required"),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const getFundHoldingsArgs = z.object({
  bw_fund_id: z.string().min(1, "bw_fund_id required (call search_funds first)"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const searchFilersArgs = z.object({
  query: z.string().min(1, "Filer name, CIK, or LEI required"),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const getFilerHoldingsArgs = z.object({
  bw_filer_id: z.string().min(1, "bw_filer_id required (call search_filers first)"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const renderArtifactArgs = z.object({
  slug: z.string().min(1),
  subject_id: z.string().min(1),
  version: z.string().default("v1"),
  as_of: z.string().default("latest"),
  format: z.enum(["json", "png", "svg"]).default("json"),
  subject_payload_json: z.string().default(""),
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

/**
 * Structured per-leg hedge basket + economic recommendation + decision-trace
 * narration. Replaces single-row "Market HR (L3) = -2.00" displays which
 * readers correctly mistake for a beta of 2.0. Includes the per-leg market-β
 * contribution column so net hedged market β is legible.
 *
 * `user_segment` drives the leverage cap that produces `recommended_hedge_level`.
 * Default is family_office (2.0× hedge gross cap). When `recommended_hedge_level`
 * differs from `lstar`, the `decision_trace` array narrates the reason — the
 * chat should render those lines verbatim.
 */
async function execGetHedgeBasket(args: z.infer<typeof getHedgeBasketArgs>) {
  const { ticker, user_segment } = args;
  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) {
    throw new Error(`Symbol not found for ticker ${ticker}`);
  }

  const latestData = await fetchLatestMetricsWithFallback(
    symbolRecord.symbol,
    [
      "l1_mkt_hr",
      "l2_mkt_hr",
      "l2_sec_hr",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l2_sec_er",
      "l3_sub_er",
      "l1_mkt_beta",
    ],
    "daily",
  );
  if (!latestData) {
    throw new Error("No metrics found");
  }

  const m = latestData.metrics;
  const sectorEtf = symbolRecord.sector_etf || null;
  const subsectorEtf = symbolRecord.subsector_etf || symbolRecord.sector_etf || null;

  const linkBetas = await readLatestLinkBetas(sectorEtf, subsectorEtf, "SPY");

  const segment = isValidUserSegment(user_segment) ? user_segment : DEFAULT_USER_SEGMENT;

  const basket = buildHedgeBasket({
    ticker: symbolRecord.ticker,
    as_of: latestData.teo,
    l1_mkt_hr: m.l1_mkt_hr ?? null,
    l2_mkt_hr: m.l2_mkt_hr ?? null,
    l2_sec_hr: m.l2_sec_hr ?? null,
    l3_mkt_hr: m.l3_mkt_hr ?? null,
    l3_sec_hr: m.l3_sec_hr ?? null,
    l3_sub_hr: m.l3_sub_hr ?? null,
    l2_sec_er: m.l2_sec_er ?? null,
    l3_sub_er: m.l3_sub_er ?? null,
    beta_m_aapl: m.l1_mkt_beta ?? null,
    sector_etf_ticker: sectorEtf,
    subsector_etf_ticker: subsectorEtf,
    market_etf_ticker: "SPY",
    lambda_s_to_m: linkBetas?.lambda_s_to_m ?? null,
    lambda_u_to_m: linkBetas?.lambda_u_to_m ?? null,
    user_segment: segment,
  });

  return basket;
}

async function execGetL3(args: z.infer<typeof getL3Args>) {
  const svc = getL3DecompositionService();
  const out = await svc.getDecomposition(args.ticker, args.market_factor_etf, {
    years: args.years,
  });
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

async function execSearchFunds(args: z.infer<typeof searchFundsArgs>) {
  const rows = await searchFunds({ q: args.query, limit: args.limit });
  // Slim payload — the analyst only needs id + ticker + name + style + identity
  // signals to decide which fund to drill into. Skip the AUM / lineage cruft.
  return {
    query: args.query,
    n_results: rows.length,
    funds: rows.map((r) => ({
      bw_fund_id: r.bw_fund_id,
      ticker: r.ticker,
      fund_name: r.fund_name,
      morningstar_category: r.morningstar_category,
      equity_style_9box: r.equity_style_9box,
      latest_report_date: r.latest_report_date,
      latest_n_holdings: r.latest_n_holdings,
    })),
  };
}

async function execSearchFilers(args: z.infer<typeof searchFilersArgs>) {
  const rows = await searchFilers({ q: args.query, limit: args.limit });
  return {
    query: args.query,
    n_results: rows.length,
    filers: rows.map((r) => ({
      bw_filer_id: r.bw_filer_id,
      name: r.name,
      cik: r.cik,
      filer_type: r.filer_type,
      filer_subtype: r.filer_subtype,
      style_label: r.style_label,
      aum_tier: r.aum_tier,
      latest_report_date: r.latest_report_date,
      latest_aum_usd: r.latest_aum_usd,
      latest_n_holdings: r.latest_n_holdings,
    })),
  };
}

async function execGetFilerHoldings(args: z.infer<typeof getFilerHoldingsArgs>) {
  const [filer, holdings] = await Promise.all([
    fetchFiler(args.bw_filer_id),
    readFilerHoldingsTopN(args.bw_filer_id, args.limit),
  ]);
  if (!filer) {
    return {
      bw_filer_id: args.bw_filer_id,
      error: "filer_not_found",
      message: `No filer with bw_filer_id=${args.bw_filer_id}. Call search_filers first.`,
    };
  }
  if (!holdings) {
    return {
      bw_filer_id: args.bw_filer_id,
      name: filer.name,
      cik: filer.cik,
      error: "holdings_unavailable",
      message:
        "Filer metadata exists but the zarr holdings cube is empty (typically: pre-13F era, not yet ingested, or insufficient coverage). Don't fabricate; tell the user.",
    };
  }
  return {
    bw_filer_id: args.bw_filer_id,
    name: filer.name,
    cik: filer.cik,
    filer_type: filer.filer_type,
    filer_subtype: filer.filer_subtype,
    style_label: filer.style_label,
    aum_tier: filer.aum_tier,
    as_of: holdings.teo,
    total_aum_usd: holdings.total_aum_usd,
    aum_in_erm3: holdings.aum_in_erm3,
    n_holdings_returned: holdings.n_holdings_returned,
    n_total_holdings: holdings.n_total_holdings,
    holdings: holdings.holdings,
  };
}

async function execRenderArtifact(args: z.infer<typeof renderArtifactArgs>) {
  let subject_payload: Record<string, unknown> | undefined;
  const raw = args.subject_payload_json?.trim();
  if (raw) {
    try {
      subject_payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        error: "invalid_subject_payload_json",
        message: "subject_payload_json must be valid JSON (e.g. {\"positions\":[{\"ticker\":\"AAPL\",\"weight\":0.5}]}).",
      };
    }
  }

  const result = await renderArtifact({
    slug: args.slug,
    version: args.version,
    subject_id: args.subject_id,
    as_of: args.as_of,
    format: args.format,
    subject_payload,
  });

  if (!result.ok) {
    return {
      error: "artifact_render_failed",
      status: result.status,
      message: result.error,
      detail: result.detail,
      wired_slugs: WIRED_ARTIFACT_RENDER_MATRIX,
    };
  }

  return {
    slug: args.slug,
    version: args.version,
    subject_id: args.subject_id,
    format: result.format,
    resolved_as_of: result.resolved_as_of,
    gcs_path: result.gcs_path,
    receipt_id: result.receipt_id,
    artifact: result.data,
  };
}

async function execGetFundHoldings(args: z.infer<typeof getFundHoldingsArgs>) {
  const [fund, holdings] = await Promise.all([
    fetchFund(args.bw_fund_id),
    readFundHoldingsTopN(args.bw_fund_id, args.limit),
  ]);
  if (!fund) {
    return {
      bw_fund_id: args.bw_fund_id,
      error: "fund_not_found",
      message: `No fund with bw_fund_id=${args.bw_fund_id}. Call search_funds first.`,
    };
  }
  if (!holdings) {
    return {
      bw_fund_id: args.bw_fund_id,
      ticker: fund.ticker,
      fund_name: fund.fund_name,
      error: "holdings_unavailable",
      message:
        "Fund metadata exists but the zarr holdings cube is empty for this fund (typically: not yet ingested or insufficient coverage). Don't fabricate; tell the user.",
    };
  }
  return {
    bw_fund_id: args.bw_fund_id,
    ticker: fund.ticker,
    fund_name: fund.fund_name,
    morningstar_category: fund.morningstar_category,
    equity_style_9box: fund.equity_style_9box,
    as_of: holdings.teo,
    aum_reported: holdings.aum_reported,
    aum_erm3: holdings.aum_erm3,
    n_holdings_returned: holdings.n_holdings_returned,
    n_total_holdings: holdings.n_total_holdings,
    holdings: holdings.holdings,
  };
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

/**
 * Phase D residual mean-reversion factor for one ticker. Returns the latest
 * reading only — the 63-point history is dropped (chat narrates the current
 * state; SDK/API callers get the full series). Always surfaces `capacity_note`
 * so the agent frames this as a combo-input factor, not a trade idea.
 */
async function execGetResidualSignal(
  args: z.infer<typeof getResidualSignalArgs>,
) {
  const { ticker } = args;
  const result = await getResidualSignalForTicker(ticker, 90);
  if (!result) {
    throw new Error(
      `No residual signal for ticker ${ticker} (not in the active universe, or insufficient history).`,
    );
  }
  const { history, ...snapshot } = result;
  return { ...snapshot, history_points: history.length };
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
    name: "get_hedge_basket",
    openaiTool: fnTool(
      "get_hedge_basket",
      "Structured hedge basket for a ticker: the four legs (stock + SPY + sector ETF + subsector ETF) with per-leg β-to-SPY contribution and a net market β subtotal, plus the L1/L2/L3 marginal ER and a `decision_trace` narration of why `recommended_hedge_level` was chosen. PREFER this over get_risk_metrics when answering 'how should I hedge X?' — it surfaces the legs that compose the L3 market HR and prevents readers from mis-reading 'Market HR (L3) = −2.00' as a beta of 2.0. The narrative answer should walk through `legs[]` as a 4-row table, show `recommended_hedge_level` (and flag the divergence from `lstar` if any), and quote the `decision_trace` lines verbatim.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker symbol, e.g. AAPL, NVDA, MSFT",
        },
        user_segment: {
          type: "string",
          enum: ["retail", "family_office", "ls_equity", "stat_arb"],
          description: "Drives the leverage cap on `recommended_hedge_level`. retail=1.5×, family_office=2.0× (default), ls_equity=3.0×, stat_arb=5.0×. Infer from session context; family_office is the safe default.",
        },
      },
      ["ticker"],
    ),
    capabilityId: "hedge-basket",
    argSchema: getHedgeBasketArgs,
    executor: async (a) => execGetHedgeBasket(getHedgeBasketArgs.parse(a)),
  },
  {
    name: "get_residual_signal",
    openaiTool: fnTool(
      "get_residual_signal",
      "Residual mean-reversion factor for a ticker: `residual_z_5d` (5-day cumulative L3 orthogonal residual, z-scored — negative = oversold, positive = overbought), `decile_rank` (1-10 cross-sectional), `signal_quality_quintile` (1-5 by subsector-tracking quality; 5 = cleanest reversion regime), `industry_percentile`, and `residual_autocorr_5d` (negative = mean-reverting). This is a COMBO-INPUT FACTOR for multi-signal alpha stacks — NOT a standalone strategy and NOT a trade recommendation. Always quote the `capacity_note` verbatim: the signal is informative pre-cost (gross Sharpe ~0.79) but net-of-impact capacity caps near ~$1M book. Never tell the user to buy or sell based on it; describe the reading and its conditioning only.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker symbol, e.g. AAPL, NVDA, MSFT",
        },
      },
      ["ticker"],
    ),
    capabilityId: "residual-signal",
    argSchema: getResidualSignalArgs,
    executor: async (a) => execGetResidualSignal(getResidualSignalArgs.parse(a)),
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
        years: {
          type: "integer",
          description: "Years of daily history, 1–15; default 1",
        },
      },
      ["ticker", "market_factor_etf", "years"],
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
      "Correlation of stock returns vs macro factors (inflation, term_spread, short_rates, credit, oil, gold, usd, volatility, bitcoin, vix_spot). volatility=VXX futures; vix_spot=FRED VIXCLS spot — different series.",
      {
        ticker: {
          type: "string",
          description: "US stock ticker, e.g. NVDA",
        },
        factors: {
          type: "array",
          items: { type: "string" },
          description: "Macro factor keys; empty array = all ten defaults. Legacy v1 names (dxy→usd, vix→vix_spot, ust10y2y→term_spread) are accepted as aliases.",
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
      "Daily macro factor total returns (no stock ticker). Ten factors: inflation, term_spread, short_rates, credit, oil, gold, usd, volatility (VXX futures), bitcoin, vix_spot (FRED VIXCLS).",
      {
        factors: {
          type: "string",
          description:
            "Comma-separated factor keys, or empty string for all ten canonical factors. Aliases (btc, wti, xau, gld, cpi, dxy, vix, ust10y2y) normalize automatically.",
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
    name: "search_funds",
    openaiTool: fnTool(
      "search_funds",
      "Resolve a mutual-fund or ETF ticker / fund name to bw_fund_id (free lookup). Use this when the user mentions a mutual fund (FCNTX, VTSAX, FXAIX) or ETF (SPY, QQQ, XLK) — BEFORE calling get_fund_holdings. Returns up to 10 matching funds with ticker, fund_name, morningstar_category, equity_style_9box, latest_report_date.",
      {
        query: {
          type: "string",
          description: "Fund ticker (e.g. FCNTX) or partial fund name (e.g. Contrafund)",
        },
        limit: {
          type: "integer",
          description: "Max results, default 10, max 25",
        },
      },
      ["query", "limit"],
    ),
    /** Free: same surface as the public /api/funds/search (no billing). */
    capabilityId: null,
    argSchema: searchFundsArgs,
    executor: async (a) => execSearchFunds(searchFundsArgs.parse(a)),
  },
  {
    name: "get_fund_holdings",
    openaiTool: fnTool(
      "get_fund_holdings",
      "Top-N current holdings for a mutual fund or ETF at its latest report date (from the most recent N-PORT filing in the system). Use AFTER search_funds resolved a bw_fund_id. Returns per-holding bw_sym_id, market value, weight, plus fund identity (ticker, fund_name, category, style, as_of date, AUM).",
      {
        bw_fund_id: {
          type: "string",
          description: "BW fund identifier from search_funds",
        },
        limit: {
          type: "integer",
          description: "Max holdings to return, default 25, max 100",
        },
      },
      ["bw_fund_id", "limit"],
    ),
    /** Same billing surface as public /api/funds/{bw_fund_id}/holdings. */
    capabilityId: "fund-holdings",
    argSchema: getFundHoldingsArgs,
    executor: async (a) => execGetFundHoldings(getFundHoldingsArgs.parse(a)),
  },
  {
    name: "search_filers",
    openaiTool: fnTool(
      "search_filers",
      "Resolve a 13F filer's name (or CIK / LEI) to bw_filer_id (free lookup). Use this when the user mentions an institutional investor — Berkshire Hathaway, Pershing Square, Bridgewater, Scion, Renaissance, Vanguard's 13F filings, etc. — BEFORE calling get_filer_holdings. Returns up to 10 matching filers with bw_filer_id, name, CIK, filer_type, style_label, AUM, latest_report_date. NOTE: filers DO NOT have tickers; search is by name / CIK / LEI.",
      {
        query: {
          type: "string",
          description: "Filer name (e.g. Berkshire, Pershing Square), CIK, or LEI",
        },
        limit: {
          type: "integer",
          description: "Max results, default 10, max 25",
        },
      },
      ["query", "limit"],
    ),
    /** Free: matches public /api/13f/filers/search (no billing). */
    capabilityId: null,
    argSchema: searchFilersArgs,
    executor: async (a) => execSearchFilers(searchFilersArgs.parse(a)),
  },
  {
    name: "get_filer_holdings",
    openaiTool: fnTool(
      "get_filer_holdings",
      "Top-N current holdings for a 13F filer at its latest report date (from the most recent 13F-HR filing in the system). Use AFTER search_filers resolved a bw_filer_id. Returns per-holding security_id, market value, weight, plus filer identity (name, CIK, type, style, as_of, AUM).",
      {
        bw_filer_id: {
          type: "string",
          description: "BW filer identifier from search_filers",
        },
        limit: {
          type: "integer",
          description: "Max holdings to return, default 25, max 100",
        },
      },
      ["bw_filer_id", "limit"],
    ),
    /** Same billing surface as public /api/13f/filers/{bw_filer_id}/holdings. */
    capabilityId: "filer-holdings",
    argSchema: getFilerHoldingsArgs,
    executor: async (a) => execGetFilerHoldings(getFilerHoldingsArgs.parse(a)),
  },
  {
    name: "render_artifact",
    openaiTool: fnTool(
      "render_artifact",
      "Deterministic artifact from the intelligence registry (fund BW-FUND-…, filer BW-FILER-…, or client portfolio BW-PORTFOLIO-…). Returns JSON chart/table/narrative payloads or PNG/SVG (base64). Use AFTER search_funds/search_filers resolved a subject_id. Prefer format=json for chat tables. For client_portfolio pass subject_payload_json with {\"positions\":[{\"ticker\":\"AAPL\",\"weight\":0.5}]}. Filer slugs need explicit as_of (filing period end). Do not invent chart data — cite fields from the artifact JSON.",
      {
        slug: {
          type: "string",
          description:
            "Artifact slug, e.g. top_holdings_erm_stacked, narrative_profile, entity_header, risk_summary_panel",
        },
        subject_id: {
          type: "string",
          description: "BW-FUND-…, BW-FILER-…, or BW-PORTFOLIO-…",
        },
        version: {
          type: "string",
          description: "Registry version tag, default v1",
        },
        as_of: {
          type: "string",
          description: "YYYY-MM-DD or latest; filers should use filing period end",
        },
        format: {
          type: "string",
          enum: ["json", "png", "svg"],
          description: "Output format, default json",
        },
        subject_payload_json: {
          type: "string",
          description:
            "Optional JSON string for BW-PORTFOLIO-* subjects: {\"positions\":[{\"ticker\":\"AAPL\",\"weight\":0.5}]}",
        },
      },
      ["slug", "subject_id", "version", "as_of", "format", "subject_payload_json"],
    ),
    capabilityId: "artifact-render",
    argSchema: renderArtifactArgs,
    executor: async (a) => execRenderArtifact(renderArtifactArgs.parse(a)),
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
