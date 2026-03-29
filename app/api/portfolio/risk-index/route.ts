import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  fetchBatchHistory,
  pivotHistory,
  resolveSymbolsByTickers,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { PortfolioRiskIndexRequestSchema } from "@/lib/api/schemas";
import { dispatchWebhookEvent } from "@/lib/api/webhooks";
import { getCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

// ── L3 ER keys needed for variance decomposition ─────────────────────
const L3_ER_KEYS: V3MetricKey[] = [
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
];

// ── Volatility + price for absolute risk ──────────────────────────────
const EXTRA_METRIC_KEYS: V3MetricKey[] = [
  "vol_23d",
  "price_close",
];

const ALL_METRIC_KEYS: V3MetricKey[] = [...L3_ER_KEYS, ...EXTRA_METRIC_KEYS];

// ── Helpers ───────────────────────────────────────────────────────────

/** Normalize weights so they sum to 1.0. */
function normalizeWeights(
  positions: { ticker: string; weight: number }[],
): { ticker: string; weight: number }[] {
  const sum = positions.reduce((acc, p) => acc + p.weight, 0);
  if (sum === 0) return positions;
  return positions.map((p) => ({ ticker: p.ticker, weight: p.weight / sum }));
}

/** Compute portfolio-weighted ER percentages from per-ticker ER values. */
function computePortfolioER(
  tickerERs: Map<string, Record<string, number | null>>,
  weights: Map<string, number>,
): { market: number; sector: number; subsector: number; residual: number } {
  let market = 0;
  let sector = 0;
  let subsector = 0;
  let residual = 0;

  for (const [ticker, w] of weights) {
    const er = tickerERs.get(ticker);
    if (!er) continue;
    market += w * (er.l3_mkt_er ?? 0);
    sector += w * (er.l3_sec_er ?? 0);
    subsector += w * (er.l3_sub_er ?? 0);
    residual += w * (er.l3_res_er ?? 0);
  }

  return { market, sector, subsector, residual };
}

/** Compute portfolio volatility (weighted average of individual vols). */
function computePortfolioVolatility(
  tickerMetrics: Map<string, Record<string, number | null>>,
  weights: Map<string, number>,
): number | null {
  let totalVol = 0;
  let hasAny = false;

  for (const [ticker, w] of weights) {
    const m = tickerMetrics.get(ticker);
    const vol = m?.vol_23d;
    if (vol != null) {
      totalVol += w * vol;
      hasAny = true;
    }
  }

  return hasAny ? totalVol : null;
}

async function getPositionCount(req: NextRequest): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body.positions?.length;
  } catch {
    return undefined;
  }
}

// ── Route handler ─────────────────────────────────────────────────────

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    // Parse body
    let rawBody: any;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    // Validate
    const validation = PortfolioRiskIndexRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { positions, timeSeries, years } = validation.data;
    const fetchStart = performance.now();

    if (positions.length === 0) {
      const metadata = await getRiskMetadata();
      const body = {
        status: "syncing" as const,
        message:
          "No holdings loaded yet. If you just linked a brokerage (e.g. Plaid), wait for the initial sync to finish.",
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
          request_id: context.requestId,
        },
      };
      const response = NextResponse.json(body, {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": "0",
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    }

    // Normalize weights
    const normalized = normalizeWeights(positions);
    const weightMap = new Map(normalized.map((p) => [p.ticker, p.weight]));
    const tickers = normalized.map((p) => p.ticker);

    // Resolve symbols
    const symbolMap = await resolveSymbolsByTickers(tickers);
    const errors: { ticker: string; error: string }[] = [];
    const resolvedTickers: string[] = [];

    for (const ticker of tickers) {
      if (!symbolMap.has(ticker)) {
        errors.push({ ticker, error: `Symbol not found for ticker ${ticker}` });
      } else {
        resolvedTickers.push(ticker);
      }
    }

    if (resolvedTickers.length === 0) {
      return NextResponse.json(
        {
          error: "No valid positions",
          message: "None of the provided tickers could be resolved",
          errors,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    // Fetch latest metrics for each resolved ticker
    const tickerMetrics = new Map<string, Record<string, number | null>>();
    const tickerTeos = new Map<string, string>();

    await Promise.all(
      resolvedTickers.map(async (ticker) => {
        const sym = symbolMap.get(ticker)!;
        const result = await fetchLatestMetricsWithFallback(
          sym.symbol,
          ALL_METRIC_KEYS,
          "daily",
        );
        if (result) {
          tickerMetrics.set(ticker, result.metrics);
          tickerTeos.set(ticker, result.teo);
        }
      }),
    );

    // Compute portfolio-level ER decomposition
    const portfolioER = computePortfolioER(tickerMetrics, weightMap);
    const systematic = portfolioER.market + portfolioER.sector + portfolioER.subsector;

    // Compute portfolio volatility (weighted average — approximation)
    const portfolioVol = computePortfolioVolatility(tickerMetrics, weightMap);

    // Per-ticker breakdown
    const perTicker: Record<string, any> = {};
    for (const ticker of resolvedTickers) {
      const m = tickerMetrics.get(ticker);
      const sym = symbolMap.get(ticker)!;
      perTicker[ticker] = {
        weight: weightMap.get(ticker),
        symbol: sym.symbol,
        teo: tickerTeos.get(ticker) ?? null,
        l3_mkt_er: m?.l3_mkt_er ?? null,
        l3_sec_er: m?.l3_sec_er ?? null,
        l3_sub_er: m?.l3_sub_er ?? null,
        l3_res_er: m?.l3_res_er ?? null,
        vol_23d: m?.vol_23d ?? null,
        price_close: m?.price_close ?? null,
      };
    }

    // Optional: time series of portfolio ER
    let timeSeriesData: any[] | undefined;
    if (timeSeries) {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - years);

      const symbols = resolvedTickers.map((t) => symbolMap.get(t)!.symbol);
      const rows = await fetchBatchHistory(symbols, L3_ER_KEYS, {
        periodicity: "daily",
        startDate: startDate.toISOString().split("T")[0],
        orderBy: "asc",
      });

      // Group by date, compute weighted ER per date
      const byDate = new Map<string, Map<string, Record<string, number | null>>>();
      for (const row of rows) {
        if (!byDate.has(row.teo)) byDate.set(row.teo, new Map());
        const dateMap = byDate.get(row.teo)!;
        // Find ticker for this symbol
        const ticker = resolvedTickers.find((t) => symbolMap.get(t)?.symbol === row.symbol);
        if (!ticker) continue;
        if (!dateMap.has(ticker)) dateMap.set(ticker, {});
        dateMap.get(ticker)![row.metric_key] = row.metric_value;
      }

      timeSeriesData = [];
      for (const [date, dateMap] of byDate) {
        const dayER = computePortfolioER(dateMap, weightMap);
        timeSeriesData.push({
          date,
          market_er: dayER.market,
          sector_er: dayER.sector,
          subsector_er: dayER.subsector,
          residual_er: dayER.residual,
          systematic_er: dayER.market + dayER.sector + dayER.subsector,
        });
      }
    }

    const fetchLatency = Math.round(performance.now() - fetchStart);
    const metadata = await getRiskMetadata();

    const responseBody: Record<string, any> = {
      portfolio_risk_index: {
        variance_decomposition: {
          market: portfolioER.market,
          sector: portfolioER.sector,
          subsector: portfolioER.subsector,
          residual: portfolioER.residual,
          systematic: systematic,
        },
        portfolio_volatility_23d: portfolioVol,
        position_count: resolvedTickers.length,
      },
      per_ticker: perTicker,
      summary: {
        total_positions: tickers.length,
        resolved: resolvedTickers.length,
        errors: errors.length,
      },
      _agent: { cost_usd: context.costUsd, request_id: context.requestId },
      _metadata: buildMetadataBody(metadata),
    };

    if (errors.length > 0) {
      responseBody.errors = errors;
    }

    if (timeSeriesData) {
      responseBody.time_series = timeSeriesData;
    }

    const response = NextResponse.json(responseBody, {
      headers: {
        ...getCorsHeaders(origin),
        "X-Data-Fetch-Latency-Ms": String(fetchLatency),
      },
    });
    addMetadataHeaders(response, metadata);

    void dispatchWebhookEvent(context.userId, "batch.completed", {
      request_id: context.requestId,
      format: "json",
      summary: {
        total: tickers.length,
        resolved: resolvedTickers.length,
        errors: errors.length,
      },
    }).catch((err) =>
      console.error("[Portfolio/risk-index] webhook dispatch", err),
    );

    return response;
  },
  {
    capabilityId: "portfolio-risk-index",
    getItemCount: getPositionCount,
  },
);

// ── CORS preflight ────────────────────────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
