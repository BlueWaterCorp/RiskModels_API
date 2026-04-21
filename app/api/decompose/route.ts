import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildMetadataBody,
} from "@/lib/dal/response-headers";
import { DecomposeRequestSchema } from "@/lib/api/schemas";

/**
 * POST /api/decompose — simplified four-layer exposure + hedge map.
 *
 * Thin handler over the shared metrics DAL. Maps the abbreviated V3 wire keys
 * (`l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr`, `l3_mkt_er`, `l3_sec_er`,
 * `l3_sub_er`, `l3_res_er`) into the semantic four-layer shape described in
 * SEMANTIC_ALIASES.md. Sign convention: `hedge[etf]` is the negative of the
 * layer `hr` (dollars of ETF short per $1 long stock).
 *
 * Same billing profile as `GET /metrics/{ticker}` ($0.001, baseline tier).
 */

const MARKET_ETF = "SPY";
const ER_SUM_TOLERANCE = 0.05;

type LayerName = "market" | "sector" | "subsector" | "residual";

interface Layer {
  er: number | null;
  hr: number | null;
  hedge_etf: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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

    const validation = DecomposeRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: corsHeaders },
      );
    }

    const { ticker } = validation.data;

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

      const sectorEtf = symbolRecord.sector_etf ?? null;
      // subsector_etf may fall back to sector_etf for stocks without a
      // dedicated subsector mapping (mirrors getMetrics behaviour).
      const subsectorEtf =
        symbolRecord.subsector_etf ?? symbolRecord.sector_etf ?? null;

      const layers: Record<LayerName, Layer> = {
        market: {
          er: num(m.l3_mkt_er),
          hr: num(m.l3_mkt_hr),
          hedge_etf: MARKET_ETF,
        },
        sector: {
          er: num(m.l3_sec_er),
          hr: num(m.l3_sec_hr),
          hedge_etf: sectorEtf,
        },
        subsector: {
          er: num(m.l3_sub_er),
          hr: num(m.l3_sub_hr),
          hedge_etf: subsectorEtf,
        },
        residual: {
          er: num(m.l3_res_er),
          hr: null,
          hedge_etf: null,
        },
      };

      // Hedge map: negative of layer HR per tradable layer (market, sector,
      // subsector). Residual is not tradable. If two layers share the same
      // ETF (e.g. subsector falls back to sector ETF), sum the hedge ratios
      // so the caller gets a single consolidated notional per instrument.
      const hedge: Record<string, number> = {};
      for (const name of ["market", "sector", "subsector"] as const) {
        const layer = layers[name];
        if (layer.hedge_etf && layer.hr !== null) {
          hedge[layer.hedge_etf] =
            (hedge[layer.hedge_etf] ?? 0) + -layer.hr;
        }
      }

      // ER sum sanity check (variance fractions sum to ~1 at L3).
      const erSum =
        (layers.market.er ?? 0) +
        (layers.sector.er ?? 0) +
        (layers.subsector.er ?? 0) +
        (layers.residual.er ?? 0);
      const erPopulated =
        layers.market.er !== null ||
        layers.sector.er !== null ||
        layers.subsector.er !== null ||
        layers.residual.er !== null;
      if (erPopulated && Math.abs(erSum - 1) > ER_SUM_TOLERANCE) {
        console.warn(
          `[decompose] ER sum off from 1 for ${ticker}: ${erSum.toFixed(4)} (tolerance ${ER_SUM_TOLERANCE})`,
        );
      }

      const responseBody = {
        ticker: symbolRecord.ticker,
        symbol: symbolRecord.symbol,
        data_as_of: metadata.data_as_of,
        teo: latestData.teo,
        exposure: layers,
        hedge,
        _metadata: buildMetadataBody(metadata),
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
      console.error(`[Decompose API] Exception for ${ticker}:`, error);
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
