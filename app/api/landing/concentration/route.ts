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
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "market_cap",
  "vol_23d",
  "stock_var",
];

const MARKET_ETF = "SPY";
const NOTIONAL_USD = 1_000_000;

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
  /** Variance-share decomposition (sums to 1 for naive, < 1 for adjusted). */
  naive: LayerER;
  adjusted: LayerER;
  /** Position-weighted naive portfolio variance σ² (annualized, decimal). */
  variance_naive: number;
  /** Correlation-adjusted portfolio variance σ² (annualized, decimal). */
  variance_adjusted: number;
  /** sqrt(variance_naive) — annualized portfolio σ before correlation. */
  sigma_naive: number;
  /** sqrt(variance_adjusted) — annualized portfolio σ after correlation. */
  sigma_adjusted: number;
  /** (var_naive − var_adjusted) / var_naive × 100 — invariant under scaling. */
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
  /** V3 hedge ratios (dollars of ETF short per $1 of stock long). */
  l3_mkt_hr: number;
  l3_sec_hr: number;
  l3_sub_hr: number;
  total_er: number;
  /** Annualized σ (decimal, e.g. 0.32 for 32%). */
  sigma: number;
  sector_etf: string | null;
  subsector_etf: string | null;
};

/**
 * Per-ETF aggregate hedge for the cap-weighted portfolio at $NOTIONAL notional.
 * `dollars` is the dollar amount of ETF that should be SHORTED (i.e. − Σ_i w_i · HR_i · notional)
 * to neutralize the layer exposure mapped to this ETF.
 */
type EtfHedge = {
  etf: string;
  layer: "market" | "sector" | "subsector";
  /** Σ_i w_i · HR_i for the cap-weighted portfolio (unsigned hedge ratio). */
  hedge_ratio: number;
  /** hedge_ratio × notional, rounded. Sign convention: positive = short this many $ of the ETF. */
  dollars: number;
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
    const tickerSigma = new Map<string, number>();

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

        const mktHr = Number(m.l3_mkt_hr ?? 0) || 0;
        const secHr = Number(m.l3_sec_hr ?? 0) || 0;
        const subHr = Number(m.l3_sub_hr ?? 0) || 0;

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

        // Annualized σ: prefer vol_23d (already annualized decimal); else
        // derive from daily stock_var (matches the original Plotly chart's
        // sqrt(stock_var × 252) fallback in _mag7_dna.row_from_p1).
        let sigma = Number(m.vol_23d ?? 0) || 0;
        if (sigma <= 0) {
          const dailyVar = Number(m.stock_var ?? 0) || 0;
          sigma = dailyVar > 0 ? Math.sqrt(dailyVar * 252) : 0;
        }
        if (sigma > 0) tickerSigma.set(ticker, sigma);

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
          l3_mkt_hr: mktHr,
          l3_sec_hr: secHr,
          l3_sub_hr: subHr,
          total_er: mkt + sec + sub + res,
          sigma,
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

      // Position-weighted naive variance (annualized): Σ_i w_i × σ_i².
      // Layer breakdown shape (naive shares) is preserved; we just rescale
      // share-space values into absolute σ² by multiplying by this constant.
      let varianceNaive = 0;
      for (const [ticker, w] of Object.entries(weights)) {
        const s = tickerSigma.get(ticker) ?? 0;
        varianceNaive += w * s * s;
      }
      const adjMultiplier =
        naive.total > 1e-12 ? adjusted.total / naive.total : 1;
      const varianceAdjusted = varianceNaive * adjMultiplier;
      const sigmaNaive = Math.sqrt(Math.max(0, varianceNaive));
      const sigmaAdjusted = Math.sqrt(Math.max(0, varianceAdjusted));
      const redundancy_pct =
        varianceNaive > 1e-12
          ? Math.max(
              0,
              ((varianceNaive - varianceAdjusted) / varianceNaive) * 100,
            )
          : 0;

      return {
        weights,
        naive,
        adjusted,
        variance_naive: varianceNaive,
        variance_adjusted: varianceAdjusted,
        sigma_naive: sigmaNaive,
        sigma_adjusted: sigmaAdjusted,
        redundancy_pct,
      };
    }

    const portfolios: { equal_weight: PortfolioBlock; cap_weighted: PortfolioBlock | null } = {
      equal_weight: toBlock(equalDiv, equalWeights),
      cap_weighted: capDiv ? toBlock(capDiv, capWeights) : null,
    };

    // ── Cap-weighted ETF hedges (Market = SPY, Sector = group by sector_etf, Subsector = group by subsector_etf) ──
    // For each layer, aggregate Σ_i w_i · HR_i across the cap-weighted portfolio,
    // grouped by the ETF symbol the layer maps to. Dollars are HR × $1M notional.
    const capEtfHedges: EtfHedge[] = [];
    if (capPositions.length) {
      const marketHr = capPositions.reduce(
        (s, { ticker, weight }) => s + weight * (perTicker[ticker]?.l3_mkt_hr ?? 0),
        0,
      );
      capEtfHedges.push({
        etf: MARKET_ETF,
        layer: "market",
        hedge_ratio: marketHr,
        dollars: Math.round(marketHr * NOTIONAL_USD),
      });

      const sectorBuckets = new Map<string, number>();
      for (const { ticker, weight } of capPositions) {
        const row = perTicker[ticker];
        if (!row?.sector_etf || !row.l3_sec_hr) continue;
        sectorBuckets.set(
          row.sector_etf,
          (sectorBuckets.get(row.sector_etf) ?? 0) + weight * row.l3_sec_hr,
        );
      }
      for (const [etf, hr] of sectorBuckets) {
        capEtfHedges.push({
          etf,
          layer: "sector",
          hedge_ratio: hr,
          dollars: Math.round(hr * NOTIONAL_USD),
        });
      }

      const subsectorBuckets = new Map<string, number>();
      for (const { ticker, weight } of capPositions) {
        const row = perTicker[ticker];
        if (!row?.subsector_etf || !row.l3_sub_hr) continue;
        subsectorBuckets.set(
          row.subsector_etf,
          (subsectorBuckets.get(row.subsector_etf) ?? 0) + weight * row.l3_sub_hr,
        );
      }
      for (const [etf, hr] of subsectorBuckets) {
        capEtfHedges.push({
          etf,
          layer: "subsector",
          hedge_ratio: hr,
          dollars: Math.round(hr * NOTIONAL_USD),
        });
      }
    }

    const metadata = await getRiskMetadata();

    return NextResponse.json(
      {
        tickers: resolved,
        per_ticker: perTicker,
        portfolios,
        cap_etf_hedges: capEtfHedges,
        notional_usd: NOTIONAL_USD,
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
