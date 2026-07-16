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
import {
  getDataLicenseMode,
  isRestrictedSourceSymbol,
  RESTRICTED_SOURCE_NOTE,
} from "@/lib/data-license";
import {
  computeHedgeRecommendationSnapshot,
  isValidUserSegment,
} from "@/lib/risk/hedge-recommendation-service";
import { buildHedgeLevels } from "@/lib/risk/hedge-levels";
import { DEFAULT_USER_SEGMENT } from "@/lib/dal/hedge-recommendation";
import { authenticateRequest } from "@/lib/supabase/auth-helper";
import { checkPlaygroundMetricsRateLimit } from "@/lib/ratelimit/playground-metrics-rate-limit";
import {
  RISKMODELS_PLAYGROUND_HEADER,
  RISKMODELS_PLAYGROUND_VALUE,
} from "@/lib/playground-metrics-headers";
import { parseFormat, formatResponse } from "@/lib/api/format-response";
import {
  CACHE_TTL,
  generateCacheKey,
  getCache,
  setCache,
} from "@/lib/cache/redis";

/**
 * L3 factor list for a single ticker: [SPY, sector_etf, subsector_etf] deduped.
 * Falls back gracefully when sector/subsector are missing.
 */
function tickerFactors(symbolRecord: {
  sector_etf?: string | null;
  subsector_etf?: string | null;
}): string[] {
  const out = ["SPY"];
  const sector = symbolRecord.sector_etf || null;
  const subsector = symbolRecord.subsector_etf || sector;
  if (sector && !out.includes(sector)) out.push(sector);
  if (subsector && !out.includes(subsector)) out.push(subsector);
  return out;
}

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
  async (request: NextRequest, context: BillingContext) => {
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

    const playground =
      request.headers.get(RISKMODELS_PLAYGROUND_HEADER) === RISKMODELS_PLAYGROUND_VALUE;
    if (playground) {
      const { user } = await authenticateRequest(request);
      if (!user) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            message: "Sign in to use the metrics playground rate limit bucket.",
          },
          { status: 401, headers: getCorsHeaders(origin) },
        );
      }
      const rl = await checkPlaygroundMetricsRateLimit(user.id);
      if (!rl.ok) {
        return NextResponse.json(
          {
            error: "Too Many Requests",
            message: "Playground metrics rate limit exceeded. Try again shortly.",
            retry_after_sec: rl.retryAfterSec,
          },
          {
            status: 429,
            headers: {
              ...getCorsHeaders(origin),
              "Retry-After": String(rl.retryAfterSec),
            },
          },
        );
      }
    }

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
      // Lstar-dispatched residual (materialized in returns zarr + Supabase wide table)
      "lstar_rr",
      "lstar_level",
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

    // Hedge recommendation snapshot: economic recommendation on top of Lstar.
    // user_segment query param drives the leverage cap; falls back to family_office
    // (2.0×) on missing / invalid values. Pure compute from already-fetched metrics
    // — no extra IO. See docs/plans/hedge-recommendation-ts-port.md for the spec
    // and ~/BW_Code/ERM3/erm3/shared/hedge_recommendation.py for the Python SSOT.
    const userSegmentRaw = request.nextUrl.searchParams.get("user_segment");
    const userSegment = isValidUserSegment(userSegmentRaw)
      ? userSegmentRaw
      : DEFAULT_USER_SEGMENT;
    const hedgeRec = computeHedgeRecommendationSnapshot({
      l1_mkt_hr: m.l1_mkt_hr ?? null,
      l2_mkt_hr: m.l2_mkt_hr ?? null,
      l2_sec_hr: m.l2_sec_hr ?? null,
      l3_mkt_hr: m.l3_mkt_hr ?? null,
      l3_sec_hr: m.l3_sec_hr ?? null,
      l3_sub_hr: m.l3_sub_hr ?? null,
      l2_sec_er: m.l2_sec_er ?? null,
      l3_sub_er: m.l3_sub_er ?? null,
      user_segment: userSegment,
    });

    const sectorEtfMn = symbolRecord.sector_etf || null;
    const subsectorEtfMn =
      symbolRecord.subsector_etf || symbolRecord.sector_etf || null;
    const hedge_levels = buildHedgeLevels(m, {
      market_etf: "SPY",
      sector_etf: sectorEtfMn,
      subsector_etf: subsectorEtfMn,
      },
      {
      recommended_level: hedgeRec.recommended_hedge_level,
      statistical_lstar: hedgeRec.lstar,
      },
    );

    // GATE 2 (CRSP derived-only symbol) / GATE 1 license_free mode / Exhibit
    // B(e)(1) (the published shared demo key is not an authenticated
    // environment): the raw latest-day close and market cap scalars are
    // withheld (nulled); every derived metric below is unaffected.
    const rawScalarsPermitted =
      !isRestrictedSourceSymbol(symbolRecord.symbol) &&
      getDataLicenseMode() !== "license_free" &&
      context.rawFieldsPermitted;

    const formattedData = {
      symbol: symbolRecord.symbol,
      ticker: symbolRecord.ticker,
      teo: latestData.teo,
      periodicity: "daily",
      ...(isRestrictedSourceSymbol(symbolRecord.symbol)
        ? RESTRICTED_SOURCE_NOTE
        : {}),
      metrics: {
        // Core
        vol_23d: m.vol_23d ?? null,
        vol_252d_ann: vol252dAnn,
        price_close: rawScalarsPermitted ? (m.price_close ?? null) : null,
        market_cap: rawScalarsPermitted ? (m.market_cap ?? null) : null,
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
        lstar_rr: m.lstar_rr ?? null,
        lstar_level: m.lstar_level ?? null,
        // Hierarchical regression betas (one per level)
        l1_mkt_beta: m.l1_mkt_beta ?? null,
        l2_sec_beta: m.l2_sec_beta ?? null,
        l3_sub_beta: m.l3_sub_beta ?? null,
        // Hedge-recommendation snapshot — economic layer on Lstar.
        // recommended_hedge_level ≠ lstar is the regime-change alert the chat surfaces.
        lstar: hedgeRec.lstar,
        recommended_hedge_level: hedgeRec.recommended_hedge_level,
        user_segment_applied: hedgeRec.user_segment_applied,
        leverage_cap_applied: hedgeRec.leverage_cap_applied,
        l1_hedge_gross: hedgeRec.l1_hedge_gross,
        l2_hedge_gross: hedgeRec.l2_hedge_gross,
        l3_hedge_gross: hedgeRec.l3_hedge_gross,
        higher_er_haircut: hedgeRec.higher_er_haircut,
      },
      meta: {
        sector_etf: symbolRecord.sector_etf || null,
        subsector_etf: symbolRecord.subsector_etf || symbolRecord.sector_etf || null,
        asset_type: symbolRecord.asset_type || null,
      },
      hedge_levels,
      _metadata: buildMetadataBody(metadata, {
        factors: tickerFactors(symbolRecord),
      }),
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
