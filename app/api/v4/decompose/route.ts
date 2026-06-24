import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  fetchRankingsFromSecurityHistory,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildMetadataBody,
} from "@/lib/dal/response-headers";
import { DecomposeV4RequestSchema } from "@/lib/api/schemas";

/**
 * POST /api/v4/decompose — canonical named-block position decomposition.
 *
 * The v4 product spine: `market + industry(sector, subsector) + style +
 * stock_specific ≈ 1.0`, with the industry block ETF-hedgeable and the style
 * block a diagnostic (exposures + incremental explained-variance, never a
 * tradeable hedge). `stock_specific` is the doubly-cleaned skill residual.
 *
 * This is the FINAL response shape. Two leaf fields are `null` until their
 * upstream producer lands and simply fill in then — no schema change:
 *   - `style.exposures.{size,value}.beta` — per-stock SMB/HML loadings (ERM3)
 *   - `stock_specific.{sharpe_36m,rank_percentile}` — Tier-2 rankings (ERM3)
 *
 * `basis` selects the explained-variance basis for the style / stock_specific
 * blocks: `L3` (default, the clean variance partition) or `lstar` (skill basis).
 * Industry hedge layers are always L3; skill metrics are always computed on L*.
 *
 * Legacy flat shape stays at POST /api/decompose. Same billing profile.
 */

const MARKET_ETF = "SPY";
const SIZE_FACTOR = "IWM-IWB"; // SMB spread (small minus big)
const VALUE_FACTOR = "IWD-IWF"; // HML spread (value minus growth)
const ER_SUM_TOLERANCE = 0.06; // looser than legacy: lstar-vs-L3 basis slack

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Hedge notional per $1 long = negative of the layer hedge ratio. */
function neg(v: number | null): number | null {
  return v === null ? null : -v;
}

/** Sum that stays null only when every operand is null. */
function sumDefined(...vals: (number | null)[]): number | null {
  const present = vals.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export const POST = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const origin = request.headers.get("origin");
    const corsHeaders = getCorsHeaders(origin);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400, headers: corsHeaders },
      );
    }

    const validation = DecomposeV4RequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: corsHeaders },
      );
    }

    const { ticker, basis } = validation.data;

    try {
      const symbolRecord = await resolveSymbolByTicker(ticker);
      if (!symbolRecord) {
        const metadata = await getRiskMetadata();
        const response = NextResponse.json(
          { error: "Symbol not found" },
          { status: 404, headers: corsHeaders },
        );
        addMetadataHeaders(response, metadata);
        return response;
      }

      const latestData = await fetchLatestMetricsWithFallback(
        symbolRecord.symbol,
        [
          // explained-variance shares (L3 cascade)
          "l3_mkt_er",
          "l3_sec_er",
          "l3_sub_er",
          "l3_res_er",
          // hedge ratios → hedge notionals
          "l3_mkt_hr",
          "l3_sec_hr",
          "l3_sub_hr",
          // regression betas (Supabase latest — distinct from hedge ratios)
          "l1_mkt_beta",
          "l2_sec_beta",
          "l3_sub_beta",
          // v4 Tier-1 explained-variance scalars, both bases
          "style_er",
          "stock_specific_er",
          "style_er_l3",
          "stock_specific_er_l3",
          // per-stock SMB/HML loadings (Supabase columns) → style.exposures.*.beta
          "size_beta",
          "value_beta",
          // 36m skill Sharpe (hedge zarr, overlay-served) → stock_specific.sharpe_36m
          "stock_specific_sharpe_36m",
        ],
        "daily",
      );

      if (!latestData) {
        const metadata = await getRiskMetadata();
        const response = NextResponse.json(
          { error: "No metrics found" },
          { status: 404, headers: corsHeaders },
        );
        addMetadataHeaders(response, metadata);
        return response;
      }

      const metadata = await getRiskMetadata();
      const m = latestData.metrics;

      // stock_specific skill rank: cross-sectional percentile of the 36m Sharpe within the
      // universe cohort (rankings zarr). Best-effort — a rankings miss leaves it null rather
      // than failing the decomposition.
      let stockSpecificRankPct: number | null = null;
      try {
        const { rankings } = await fetchRankingsFromSecurityHistory(
          symbolRecord.symbol,
          { metric: "stock_specific_lstar", cohort: "universe", window: "1d" },
        );
        const row = rankings.find(
          (r) =>
            r.metric === "stock_specific_lstar" &&
            r.cohort === "universe" &&
            r.window === "1d",
        );
        stockSpecificRankPct = row?.rank_percentile ?? null;
      } catch (err) {
        console.warn(
          `[v4/decompose] stock_specific rankings lookup failed for ${ticker}:`,
          err,
        );
      }

      const sectorEtf = symbolRecord.sector_etf ?? null;
      const subsectorEtf =
        symbolRecord.subsector_etf ?? symbolRecord.sector_etf ?? null;

      // basis selects which ER scalars feed style / stock_specific.
      const styleEv =
        basis === "lstar" ? num(m.style_er) : num(m.style_er_l3);
      const stockSpecificEv =
        basis === "lstar"
          ? num(m.stock_specific_er)
          : num(m.stock_specific_er_l3);

      const marketEv = num(m.l3_mkt_er);
      const sectorEv = num(m.l3_sec_er);
      const subsectorEv = num(m.l3_sub_er);

      const decomposition = {
        market: {
          factor: MARKET_ETF,
          beta: num(m.l1_mkt_beta),
          explained_variance: marketEv,
          hedge_notional_per_1_long: neg(num(m.l3_mkt_hr)),
          hedgeable: true,
        },
        industry: {
          explained_variance: sumDefined(sectorEv, subsectorEv),
          hedgeable: true,
          layers: {
            sector: {
              etf: sectorEtf,
              beta: num(m.l2_sec_beta),
              explained_variance: sectorEv,
              hedge_notional_per_1_long: neg(num(m.l3_sec_hr)),
            },
            subsector: {
              etf: subsectorEtf,
              beta: num(m.l3_sub_beta),
              explained_variance: subsectorEv,
              hedge_notional_per_1_long: neg(num(m.l3_sub_hr)),
            },
          },
        },
        style: {
          explained_variance: styleEv,
          hedgeable: false,
          role: "diagnostic",
          // Per-stock size/value loadings from the stock_specific strip (lstar basis).
          exposures: {
            size: { factor: SIZE_FACTOR, beta: num(m.size_beta) },
            value: { factor: VALUE_FACTOR, beta: num(m.value_beta) },
          },
        },
        stock_specific: {
          explained_variance: stockSpecificEv,
          // Tier-2 skill metrics (computed on L*): 36m Sharpe of the skill residual and its
          // cross-sectional rank percentile within the universe cohort.
          sharpe_36m: num(m.stock_specific_sharpe_36m),
          rank_percentile: stockSpecificRankPct,
        },
      };

      // Partition sanity: market + sector + subsector + style + stock_specific ≈ 1
      // (clean on the L3 basis; looser tolerance on lstar).
      const parts = [
        marketEv,
        sectorEv,
        subsectorEv,
        styleEv,
        stockSpecificEv,
      ];
      const erPopulated = parts.some((p) => p !== null);
      const erSum = parts.reduce<number>((a, p) => a + (p ?? 0), 0);
      if (erPopulated && Math.abs(erSum - 1) > ER_SUM_TOLERANCE) {
        console.warn(
          `[v4/decompose] ER sum off from 1 for ${ticker} (basis=${basis}): ${erSum.toFixed(4)}`,
        );
      }

      const factors = [MARKET_ETF];
      for (const etf of [sectorEtf, subsectorEtf]) {
        if (etf && !factors.includes(etf)) factors.push(etf);
      }

      const responseBody = {
        ticker: symbolRecord.ticker,
        symbol: symbolRecord.symbol,
        basis,
        data_as_of: metadata.data_as_of,
        teo: latestData.teo,
        decomposition,
        _metadata: buildMetadataBody(metadata, { factors }),
        _data_health: {
          er_populated: erPopulated,
          er_sum: erPopulated ? erSum : null,
        },
      };

      const response = NextResponse.json(responseBody, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (error) {
      console.error(`[v4/decompose] Exception for ${ticker}:`, error);
      const metadata = await getRiskMetadata().catch(() => null);
      const response = NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500, headers: corsHeaders },
      );
      if (metadata) addMetadataHeaders(response, metadata);
      return response;
    }
  },
  { capabilityId: "decompose-position" },
);
