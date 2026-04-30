import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolsByTickers,
  fetchBatchHistory,
  type SecurityHistoryRow,
  type SymbolRegistryRow,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import {
  WALKTHROUGH_MAG7_TICKERS,
  LANDING_SNAPSHOT_METRIC_KEYS,
  buildLandingTickerSnapshot,
  landingStartOfYearUTC,
  type LandingTickerSnapshot,
} from "@/lib/landing/walkthrough-chart-data";

/**
 * GET /api/landing/mag7-hero — unauthenticated landing-page snapshots for the
 * MAG7 walkthrough chart. Returns the LandingTickerSnapshot shape (single bar
 * + 5-field line) that RiskWalkthroughChart consumes directly.
 */

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const mag7 = [...WALKTHROUGH_MAG7_TICKERS];
    const symbolMap = await resolveSymbolsByTickers(mag7);
    const symbols: string[] = [];
    const symByTicker: Record<string, SymbolRegistryRow> = {};
    for (const ticker of mag7) {
      const resolved = symbolMap.get(ticker);
      if (resolved?.symbol) {
        symbols.push(resolved.symbol);
        symByTicker[ticker] = resolved;
      }
    }

    if (symbols.length === 0) {
      return NextResponse.json(
        { error: "No Mag7 symbols resolved" },
        { status: 500, headers: corsHeaders },
      );
    }

    const startDate = landingStartOfYearUTC();

    const rows = await fetchBatchHistory(symbols, LANDING_SNAPSHOT_METRIC_KEYS, {
      periodicity: "daily",
      startDate,
      orderBy: "asc",
    });

    const bySymbol = new Map<string, SecurityHistoryRow[]>();
    for (const row of rows) {
      const list = bySymbol.get(row.symbol) ?? [];
      list.push(row);
      bySymbol.set(row.symbol, list);
    }

    const snapshots: Record<string, LandingTickerSnapshot> = {};
    for (const ticker of mag7) {
      const sym = symByTicker[ticker];
      if (!sym?.symbol) continue;
      const tickerRows = bySymbol.get(sym.symbol) ?? [];
      const snap = buildLandingTickerSnapshot(ticker, sym, tickerRows);
      if (snap) snapshots[ticker] = snap;
    }

    const metadata = await getRiskMetadata();

    return NextResponse.json(
      {
        tickers: mag7,
        snapshots,
        data_as_of: metadata.data_as_of,
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
    console.error("[Landing Mag7 Hero] Exception:", error);
    return NextResponse.json(
      {
        error: "Failed to build Mag7 landing hero data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders },
    );
  }
}
