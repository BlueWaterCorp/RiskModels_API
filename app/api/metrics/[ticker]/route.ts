import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { resolveSymbolByTicker, fetchLatestMetrics } from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const ticker = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");

    if (!ticker) {
      return NextResponse.json(
        { error: "Ticker parameter is required" },
        { status: 400 },
      );
    }

    try {
    console.log(`[Metrics API] Fetching ${ticker} from V3 contract...`);

    const symbolRecord = await resolveSymbolByTicker(ticker.toUpperCase());

    if (!symbolRecord) {
      console.warn(`[Metrics API] No symbol found for ${ticker}`);
      const metadata = await getRiskMetadata();
      const response = NextResponse.json({ error: "Symbol not found" }, { status: 404 });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const latestData = await fetchLatestMetrics(symbolRecord.symbol, [
      "vol_23d",
      "price_close",
      "market_cap",
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l3_res_er"
    ], "daily");

    if (!latestData) {
      const metadata = await getRiskMetadata();
      const response = NextResponse.json({ error: "No metrics found" }, { status: 404 });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const metadata = await getRiskMetadata();
    const formattedData = {
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
      _metadata: buildMetadataBody(metadata),
    };

    const erFieldsEmpty = !formattedData.metrics.l3_mkt_er && !formattedData.metrics.l3_sec_er && !formattedData.metrics.l3_sub_er;
    if (erFieldsEmpty) {
      console.warn(`[metrics] ER fields missing for ${ticker} on ${latestData.teo} — security_history may not be populated. Run sync_erm3_to_supabase_v3.py.`);
    }

    const responseBody = {
      ...formattedData,
      _data_health: {
        er_populated: !erFieldsEmpty,
        data_as_of: metadata.data_as_of,
      },
    };

    console.log(
      `[Metrics API] Successfully fetched ${ticker} from V3, hasL3: ${formattedData.metrics.l3_mkt_hr !== null}`,
    );

    const response = NextResponse.json(responseBody, {
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
    addMetadataHeaders(response, metadata);
    return response;
  } catch (error) {
    console.error(`[Metrics API] Exception fetching ${ticker}:`, error);
    const metadata = await getRiskMetadata();
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
    addMetadataHeaders(response, metadata);
    return response;
  }
  },
  { capabilityId: "metrics-snapshot" },
);
