import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import { DecomposeRequestSchema } from "@/lib/api/schemas";

/**
 * POST /api/landing/decompose — unauthenticated MAG7-only preview of
 * `POST /decompose` for the landing-page interactive widget.
 *
 * This route does not go through the paid-billing middleware: it is a read
 * path that only accepts a hard-coded allowlist of Magnificent-7 tickers and
 * returns the same simplified four-bet shape. For anything beyond the
 * allowlist, clients must use the real, keyed `POST /api/decompose`.
 */

const MAG7_ALLOWLIST = new Set([
  "AAPL",
  "MSFT",
  "GOOGL",
  "GOOG",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
]);

const MARKET_ETF = "SPY";

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
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
  if (!MAG7_ALLOWLIST.has(ticker)) {
    return NextResponse.json(
      {
        error: "Ticker not available in landing preview",
        message:
          "This preview only supports MAG7 tickers. Use POST /api/decompose with an API key for the full universe.",
        allowed: Array.from(MAG7_ALLOWLIST),
      },
      { status: 403, headers: corsHeaders },
    );
  }

  try {
    const symbolRecord = await resolveSymbolByTicker(ticker);
    if (!symbolRecord) {
      return NextResponse.json(
        { error: "Symbol not found" },
        { status: 404, headers: corsHeaders },
      );
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
      return NextResponse.json(
        { error: "No metrics found" },
        { status: 404, headers: corsHeaders },
      );
    }

    const metadata = await getRiskMetadata();
    const m = latestData.metrics;
    const sectorEtf = symbolRecord.sector_etf ?? null;
    const subsectorEtf =
      symbolRecord.subsector_etf ?? symbolRecord.sector_etf ?? null;

    const layers = {
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
        hr: null as number | null,
        hedge_etf: null as string | null,
      },
    };

    const hedge: Record<string, number> = {};
    for (const name of ["market", "sector", "subsector"] as const) {
      const layer = layers[name];
      if (layer.hedge_etf && layer.hr !== null) {
        hedge[layer.hedge_etf] = (hedge[layer.hedge_etf] ?? 0) + -layer.hr;
      }
    }

    return NextResponse.json(
      {
        ticker: symbolRecord.ticker,
        symbol: symbolRecord.symbol,
        data_as_of: metadata.data_as_of,
        teo: latestData.teo,
        exposure: layers,
        hedge,
        _metadata: buildMetadataBody(metadata),
        _preview: true,
      },
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error(`[Landing Decompose] Exception for ${ticker}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
