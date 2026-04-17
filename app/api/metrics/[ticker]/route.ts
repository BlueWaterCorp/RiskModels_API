import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
  fetchHistoryWithSource,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { MetricsRequestSchema } from "@/lib/api/schemas";
import { parseFormat, formatResponse } from "@/lib/api/format-response";
import {
  CACHE_TTL,
  generateCacheKey,
  getCache,
  setCache,
} from "@/lib/cache/redis";

/**
 * Trailing-252-day annualised daily-return volatility, keyed by (symbol, data_as_of).
 * Cached for 24h because vol_252d only rolls once per EOD; on a warm cache this is
 * O(10ms), on cold ~3-5s for the history pull. `data_as_of` in the key auto-invalidates
 * on a new trading day.
 */
async function computeVol252dAnnualised(
  symbol: string,
  dataAsOf: string | null | undefined,
): Promise<number | null> {
  const key = generateCacheKey("vol252d", symbol, { asof: dataAsOf ?? "unknown" });
  const cached = await getCache<number | null>(key);
  if (cached !== null && cached !== undefined) return cached;

  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const startDate = start.toISOString().split("T")[0];

  try {
    const { rows } = await fetchHistoryWithSource(symbol, ["returns_gross"], {
      periodicity: "daily",
      startDate,
      orderBy: "asc",
    });
    const returns: number[] = rows
      .filter((r) => r.metric_key === "returns_gross")
      .map((r) => (r.metric_value == null ? NaN : Number(r.metric_value)))
      .filter((v) => Number.isFinite(v));
    if (returns.length < 20) {
      await setCache(key, null, CACHE_TTL.HISTORICAL);
      return null;
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const volAnn = Math.sqrt(variance) * Math.sqrt(252);
    await setCache(key, volAnn, CACHE_TTL.HISTORICAL);
    return volAnn;
  } catch (err) {
    console.warn("[metrics.vol_252d_ann] compute failed", { symbol, err });
    return null;
  }
}

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const rawTicker = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");

    const validation = MetricsRequestSchema.safeParse({ ticker: rawTicker });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed ticker",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker } = validation.data;

    try {
    console.log(`[Metrics API] Fetching ${ticker} from V3 contract...`);

    const symbolRecord = await resolveSymbolByTicker(ticker);

    if (!symbolRecord) {
      console.warn(`[Metrics API] No symbol found for ${ticker}`);
      const metadata = await getRiskMetadata();
      const response = NextResponse.json({ error: "Symbol not found" }, { status: 404, headers: getCorsHeaders(origin) });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const fetchStart = performance.now();
    const latestData = await fetchLatestMetricsWithFallback(symbolRecord.symbol, [
      // Core
      "vol_23d",
      "price_close",
      "market_cap",
      "stock_var",
      // L1
      "l1_mkt_hr",
      "l1_mkt_er",
      "l1_res_er",
      "l1_cfr",
      "l1_rr",
      // L2
      "l2_mkt_hr",
      "l2_sec_hr",
      "l2_mkt_er",
      "l2_sec_er",
      "l2_res_er",
      "l2_cfr",
      "l2_rr",
      // L3
      "l3_mkt_hr",
      "l3_sec_hr",
      "l3_sub_hr",
      "l3_mkt_er",
      "l3_sec_er",
      "l3_sub_er",
      "l3_res_er",
      "l3_cfr",
      "l3_rr",
      // Hierarchical regression betas (one per level)
      "l1_mkt_beta",
      "l2_sec_beta",
      "l3_sub_beta",
    ], "daily");

    if (!latestData) {
      const metadata = await getRiskMetadata();
      const response = NextResponse.json({ error: "No metrics found" }, { status: 404 });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const metadata = await getRiskMetadata();
    const m = latestData.metrics;

    // vol_252d is computed on demand (not stored upstream) and cached for 24h.
    // Run in parallel with the rest of response assembly; no await here lets the
    // two await points compose if we ever split computation further.
    const vol252dAnn = await computeVol252dAnnualised(
      symbolRecord.symbol,
      metadata.data_as_of,
    );

    const formattedData = {
      symbol: symbolRecord.symbol,
      ticker: symbolRecord.ticker,
      teo: latestData.teo,
      periodicity: "daily",
      metrics: {
        // Core
        vol_23d: m.vol_23d ?? null,
        vol_252d_ann: vol252dAnn,
        price_close: m.price_close ?? null,
        market_cap: m.market_cap ?? null,
        stock_var: m.stock_var ?? null,
        // L1
        l1_mkt_hr: m.l1_mkt_hr ?? null,
        l1_mkt_er: m.l1_mkt_er ?? null,
        l1_res_er: m.l1_res_er ?? null,
        l1_cfr: m.l1_cfr ?? null,
        l1_rr: m.l1_rr ?? null,
        // L2
        l2_mkt_hr: m.l2_mkt_hr ?? null,
        l2_sec_hr: m.l2_sec_hr ?? null,
        l2_mkt_er: m.l2_mkt_er ?? null,
        l2_sec_er: m.l2_sec_er ?? null,
        l2_res_er: m.l2_res_er ?? null,
        l2_cfr: m.l2_cfr ?? null,
        l2_rr: m.l2_rr ?? null,
        // L3
        l3_mkt_hr: m.l3_mkt_hr ?? null,
        l3_sec_hr: m.l3_sec_hr ?? null,
        l3_sub_hr: m.l3_sub_hr ?? null,
        l3_mkt_er: m.l3_mkt_er ?? null,
        l3_sec_er: m.l3_sec_er ?? null,
        l3_sub_er: m.l3_sub_er ?? null,
        l3_res_er: m.l3_res_er ?? null,
        l3_cfr: m.l3_cfr ?? null,
        l3_rr: m.l3_rr ?? null,
        // Hierarchical regression betas (one per level)
        l1_mkt_beta: m.l1_mkt_beta ?? null,
        l2_sec_beta: m.l2_sec_beta ?? null,
        l3_sub_beta: m.l3_sub_beta ?? null,
      },
      meta: {
        sector_etf: symbolRecord.sector_etf || null,
        subsector_etf: symbolRecord.subsector_etf || symbolRecord.sector_etf || null,
        asset_type: symbolRecord.asset_type || null,
      },
      _metadata: buildMetadataBody(metadata),
    };

    const format = parseFormat(request.nextUrl.searchParams, request.headers.get("accept"));
    if (format !== "json") {
      const rows = [{
        ticker: formattedData.ticker,
        symbol: formattedData.symbol,
        teo: formattedData.teo,
        periodicity: formattedData.periodicity,
        ...formattedData.metrics,
        ...formattedData.meta,
      }];
      return formatResponse({
        rows,
        format,
        filename: `${ticker}_metrics.csv`,
        extraHeaders: getCorsHeaders(origin) as Record<string, string>,
      });
    }

    const erFieldsEmpty = !formattedData.metrics.l3_mkt_er && !formattedData.metrics.l3_sec_er && !formattedData.metrics.l3_sub_er;
    if (erFieldsEmpty) {
      console.warn(`[metrics] ER fields missing for ${ticker} on ${latestData.teo} — security_history may not be populated. Run sync_erm3_to_supabase_v3.py.`);
    }

    const responseBody = {
      ...formattedData,
      _data_health: {
        er_populated: !erFieldsEmpty,
        vol_populated: formattedData.metrics.vol_23d !== null,
        l1_populated: formattedData.metrics.l1_mkt_hr !== null,
        l2_populated: formattedData.metrics.l2_mkt_hr !== null,
        data_as_of: metadata.data_as_of,
      },
    };

    console.log(
      `[Metrics API] Successfully fetched ${ticker} from V3, hasL1: ${m.l1_mkt_hr !== null}, hasL2: ${m.l2_mkt_hr !== null}, hasL3: ${m.l3_mkt_hr !== null}`,
    );

    const fetchLatency = Math.round(performance.now() - fetchStart);
    const response = NextResponse.json(responseBody, {
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Data-Fetch-Latency-Ms": String(fetchLatency),
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
