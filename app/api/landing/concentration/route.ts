import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolsByTickers,
  fetchLatestMetricsWithFallback,
  type V3MetricKey,
} from "@/lib/dal/risk-engine-v3";
import {
  computeDiversificationMetrics,
  type DiversificationTickerMetrics,
  type DiversificationResult,
} from "@/lib/portfolio/portfolio-diversification";
import { fetchEtfCorrelationMatrices } from "@/lib/portfolio/portfolio-diversification-etf-returns";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import {
  WALKTHROUGH_MAG7_TICKERS,
  WALKTHROUGH_MAG7_NAMES,
} from "@/lib/landing/walkthrough-chart-data";

/**
 * GET /api/landing/concentration — unauthenticated MAG7 concentration / diversification
 * payload for the landing-page Marimekko + dual-portfolio chart.
 */

const METRIC_KEYS: V3MetricKey[] = [
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "l3_res_er",
  "market_cap",
  "vol_23d",
];

const WINDOW_DAYS = 252;

type LayerER = {
  market_er: number;
  sector_er: number;
  subsector_er: number;
  residual_er: number;
  total: number;
};

type PortfolioBlock = {
  weights: Record<string, number>;
  naive: LayerER;
  adjusted: LayerER;
  redundancy_pct: number;
};

type ConcentrationTicker = {
  ticker: string;
  name: string | null;
  market_cap: number | null;
  l3_mkt_er: number;
  l3_sec_er: number;
  l3_sub_er: number;
  l3_res_er: number;
  total_er: number;
  sector_etf: string | null;
  subsector_etf: string | null;
};

function buildLayerER(d: DiversificationResult, basis: "naive_pws" | "correlation_adjusted"): LayerER {
  const src = d[basis];
  return {
    market_er: src.market_er,
    sector_er: src.sector_er,
    subsector_er: src.subsector_er,
    residual_er: src.residual_er,
    total: src.total,
  };
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const tickers = [...WALKTHROUGH_MAG7_TICKERS];
    const symbolMap = await resolveSymbolsByTickers(tickers);

    const tickerMetrics = new Map<string, DiversificationTickerMetrics>();
    const perTicker: Record<string, ConcentrationTicker> = {};
    const sectorEtfSet = new Set<string>();
    const subsectorEtfSet = new Set<string>();
    const marketCaps = new Map<string, number>();

    await Promise.all(
      tickers.map(async (ticker) => {
        const sym = symbolMap.get(ticker);
        if (!sym?.symbol) return;

        const result = await fetchLatestMetricsWithFallback(
          sym.symbol,
          METRIC_KEYS,
          "daily",
        );
        if (!result) return;

        const m = result.metrics;
        const sectorEtf = sym.sector_etf ?? null;
        const subsectorEtf = sym.subsector_etf ?? sym.sector_etf ?? null;

        const mkt = Number(m.l3_mkt_er ?? 0) || 0;
        const sec = Number(m.l3_sec_er ?? 0) || 0;
        const sub = Number(m.l3_sub_er ?? 0) || 0;
        const res = Number(m.l3_res_er ?? 0) || 0;

        tickerMetrics.set(ticker, {
          l3_mkt_er: mkt,
          l3_sec_er: sec,
          l3_sub_er: sub,
          l3_res_er: res,
          sector_etf: sectorEtf,
          subsector_etf: subsectorEtf,
        });

        const cap = m.market_cap != null ? Number(m.market_cap) : null;
        if (cap && Number.isFinite(cap) && cap > 0) {
          marketCaps.set(ticker, cap);
        }

        if (sectorEtf) sectorEtfSet.add(sectorEtf);
        if (subsectorEtf) subsectorEtfSet.add(subsectorEtf);

        perTicker[ticker] = {
          ticker,
          name: sym.name ?? WALKTHROUGH_MAG7_NAMES[ticker] ?? null,
          market_cap: cap,
          l3_mkt_er: mkt,
          l3_sec_er: sec,
          l3_sub_er: sub,
          l3_res_er: res,
          total_er: mkt + sec + sub + res,
          sector_etf: sectorEtf,
          subsector_etf: subsectorEtf,
        };
      }),
    );

    const resolved = tickers.filter((t) => perTicker[t]);
    if (resolved.length === 0) {
      return NextResponse.json(
        { error: "No MAG7 metrics resolved" },
        { status: 500, headers: corsHeaders },
      );
    }

    const etfCorrelations = await fetchEtfCorrelationMatrices(
      [...sectorEtfSet],
      [...subsectorEtfSet],
      WINDOW_DAYS,
    );

    // Equal-weight portfolio
    const eqWeight = 1 / resolved.length;
    const equalWeights: Record<string, number> = {};
    for (const t of resolved) equalWeights[t] = eqWeight;
    const equalPositions = resolved.map((t) => ({ ticker: t, weight: eqWeight }));

    // Cap-weight portfolio (only over tickers with a known cap; renormalize)
    const capTickers = resolved.filter((t) => marketCaps.has(t));
    const capTotal = capTickers.reduce((s, t) => s + (marketCaps.get(t) ?? 0), 0);
    const capWeights: Record<string, number> = {};
    const capPositions: { ticker: string; weight: number }[] = [];
    if (capTotal > 0) {
      for (const t of capTickers) {
        const w = (marketCaps.get(t) ?? 0) / capTotal;
        capWeights[t] = w;
        capPositions.push({ ticker: t, weight: w });
      }
    }

    const equalDiv = computeDiversificationMetrics({
      positions: equalPositions,
      tickerMetrics,
      etfCorrelations,
      windowDays: WINDOW_DAYS,
    });

    const capDiv = capPositions.length
      ? computeDiversificationMetrics({
          positions: capPositions,
          tickerMetrics,
          etfCorrelations,
          windowDays: WINDOW_DAYS,
        })
      : null;

    function toBlock(div: DiversificationResult, weights: Record<string, number>): PortfolioBlock {
      const naive = buildLayerER(div, "naive_pws");
      const adjusted = buildLayerER(div, "correlation_adjusted");
      const redundancy_pct =
        naive.total > 1e-12
          ? Math.max(0, ((naive.total - adjusted.total) / naive.total) * 100)
          : 0;
      return { weights, naive, adjusted, redundancy_pct };
    }

    const portfolios: { equal_weight: PortfolioBlock; cap_weighted: PortfolioBlock | null } = {
      equal_weight: toBlock(equalDiv, equalWeights),
      cap_weighted: capDiv ? toBlock(capDiv, capWeights) : null,
    };

    const metadata = await getRiskMetadata();

    return NextResponse.json(
      {
        tickers: resolved,
        per_ticker: perTicker,
        portfolios,
        data_as_of: metadata.data_as_of,
        window_days: WINDOW_DAYS,
        _metadata: buildMetadataBody(metadata),
        _preview: true,
      },
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control":
            "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("[Landing Concentration] Exception:", error);
    return NextResponse.json(
      {
        error: "Failed to build concentration payload",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders },
    );
  }
}
