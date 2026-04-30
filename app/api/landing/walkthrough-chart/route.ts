import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolsByTickers,
  fetchBatchHistory,
  type SecurityHistoryRow,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import {
  WALKTHROUGH_MAG7_SET,
  LANDING_SNAPSHOT_METRIC_KEYS,
  buildLandingTickerSnapshot,
  landingStartOfYearUTC,
} from "@/lib/landing/walkthrough-chart-data";

/**
 * GET /api/landing/walkthrough-chart?ticker=NVDA
 *
 * Same snapshot shape as a single entry in `GET /api/landing/mag7-hero`.
 * Mag7 tickers are public (cached). Any other ticker requires a signed-in
 * session, Supabase JWT bearer, or valid rm_* API key (see authenticateRequest).
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const raw = request.nextUrl.searchParams.get("ticker")?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "Missing ticker", requires_auth: false },
      { status: 400, headers: corsHeaders },
    );
  }
  const ticker = raw.toUpperCase();

  if (!WALKTHROUGH_MAG7_SET.has(ticker)) {
    const { user, error } = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        {
          error:
            error ??
            "Sign in (or use an API key) to load tickers outside the Mag7 set.",
          requires_auth: true,
        },
        { status: 401, headers: corsHeaders },
      );
    }
  }

  try {
    const symbolMap = await resolveSymbolsByTickers([ticker]);
    const sym = symbolMap.get(ticker);
    if (!sym?.symbol) {
      return NextResponse.json(
        { error: "Unknown ticker", ticker },
        { status: 404, headers: corsHeaders },
      );
    }

    const rows: SecurityHistoryRow[] = await fetchBatchHistory(
      [sym.symbol],
      LANDING_SNAPSHOT_METRIC_KEYS,
      {
        periodicity: "daily",
        startDate: landingStartOfYearUTC(),
        orderBy: "asc",
      },
    );

    const snapshot = buildLandingTickerSnapshot(ticker, sym, rows);
    if (!snapshot) {
      return NextResponse.json(
        { error: "No history for ticker", ticker },
        { status: 404, headers: corsHeaders },
      );
    }

    const metadata = await getRiskMetadata();
    const cacheControl = WALKTHROUGH_MAG7_SET.has(ticker)
      ? "public, s-maxage=3600, stale-while-revalidate=86400"
      : "private, no-store";

    return NextResponse.json(
      {
        ticker,
        snapshot,
        data_as_of: metadata.data_as_of,
        _metadata: buildMetadataBody(metadata),
      },
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": cacheControl,
        },
      },
    );
  } catch (error) {
    console.error("[Landing Walkthrough Chart] Exception:", error);
    return NextResponse.json(
      {
        error: "Failed to build walkthrough chart",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders },
    );
  }
}
