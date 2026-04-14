import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchBatchLatestSummary,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

const MAX_TICKERS = 100;

/**
 * GET /api/batch/latest-metrics?tickers=AAPL,MSFT,NVDA
 * Latest L3 (and snapshot) fields from `security_history_latest` in one round-trip.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");
    const raw = searchParams.get("tickers")?.trim() ?? "";

    if (!raw) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Query parameter `tickers` is required (comma-separated).",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const tickerList = [
      ...new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ].slice(0, MAX_TICKERS);

    if (tickerList.length === 0) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Provide at least one ticker symbol.",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const resolved: { ticker: string; symbol: string }[] = [];
    for (const t of tickerList) {
      const row = await resolveSymbolByTicker(t);
      if (row) {
        resolved.push({ ticker: row.ticker, symbol: row.symbol });
      }
    }

    if (resolved.length === 0) {
      return NextResponse.json(
        {
          error: "Not found",
          message: "No matching tickers in the universe.",
        },
        { status: 404, headers: getCorsHeaders(origin) },
      );
    }

    const symbols = [...new Set(resolved.map((r) => r.symbol))];
    const batchMap = await fetchBatchLatestSummary(symbols, "daily");

    const data = resolved.map(({ ticker, symbol }) => {
      const latest = batchMap.get(symbol);
      if (!latest) {
        return {
          ticker,
          date: null,
          l3_mkt_hr: null,
          l3_sec_hr: null,
          l3_sub_hr: null,
          l3_mkt_er: null,
          l3_sec_er: null,
          l3_sub_er: null,
        };
      }
      const m = latest.metrics;
      return {
        ticker,
        date: latest.teo,
        l3_mkt_hr: m.l3_mkt_hr ?? null,
        l3_sec_hr: m.l3_sec_hr ?? null,
        l3_sub_hr: m.l3_sub_hr ?? null,
        l3_mkt_er: m.l3_mkt_er ?? null,
        l3_sec_er: m.l3_sec_er ?? null,
        l3_sub_er: m.l3_sub_er ?? null,
      };
    });

    const metadata = await getRiskMetadata();
    const response = NextResponse.json(
      {
        data,
        source: "security_history_latest",
        _metadata: buildMetadataBody(metadata, { data_source: "supabase" }),
      },
      { headers: getCorsHeaders(origin) },
    );
    addMetadataHeaders(response, metadata);
    return response;
  },
  { capabilityId: "metrics-snapshot" },
);
