/**
 * GET /api/hedge-basket/[ticker]
 *
 * Structured hedge-basket payload — the recommended level's legs (stock + SPY,
 * plus the sector ETF at L2 and the subsector ETF at L3) with a net-market-β
 * subtotal, plus a `decision_trace` explaining why `recommended_hedge_level`
 * was chosen.
 *
 * Composes the latest-teo metric snapshot (HRs, ERs, betas) with link-betas
 * from the cohort store (`ds_erm3_cohorts_{factor_set}.zarr`, via
 * `readLatestLinkBetas`) into a structured response the chat narrates verbatim.
 * A beta that cannot be read is null with a `data_quality_flags` entry — never 0.
 *
 * `?user_segment=` drives the leverage cap. Defaults to family_office (2.0×).
 *
 * @see lib/risk/hedge-recommendation-service.ts (buildHedgeBasket)
 * @see docs/plans/hedge-recommendation-ts-port.md
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/cors";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  resolveSymbolByTicker,
  fetchLatestMetricsWithFallback,
} from "@/lib/dal/risk-engine-v3";
import { isServedMarketFactorEtf, readLatestLinkBetas } from "@/lib/dal/zarr-reader";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { buildHedgeBasket } from "@/lib/risk/hedge-recommendation-service";
import { buildHedgeLevels } from "@/lib/risk/hedge-levels";
import { HedgeBasketRequestSchema } from "@/lib/api/schemas";

export const runtime = "nodejs";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const rawTicker = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");

    const validation = HedgeBasketRequestSchema.safeParse({
      ticker: rawTicker,
      user_segment: request.nextUrl.searchParams.get("user_segment") ?? undefined,
      market_factor_etf: request.nextUrl.searchParams.get("market_factor_etf") ?? undefined,
    });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]!.message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker, user_segment, market_factor_etf } = validation.data;

    // Hedge ratios and link betas exist only for the market factor the model is
    // rooted on. Labelling them with another ETF would misstate every leg.
    if (!isServedMarketFactorEtf(market_factor_etf)) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: `market_factor_etf=${market_factor_etf.toUpperCase()} is not served; hedge baskets are computed against SPY. Omit the parameter or pass SPY.`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    try {
      const fetchStart = performance.now();

      const symbolRecord = await resolveSymbolByTicker(ticker);
      if (!symbolRecord) {
        const metadata = await getRiskMetadata();
        const response = NextResponse.json(
          { error: "Symbol not found" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
        addMetadataHeaders(response, metadata);
        return response;
      }

      const latestData = await fetchLatestMetricsWithFallback(
        symbolRecord.symbol,
        [
          "lstar_level",
          "l1_mkt_hr",
          "l1_mkt_er",
          "l1_res_er",
          "l2_mkt_hr",
          "l2_sec_hr",
          "l2_mkt_er",
          "l2_sec_er",
          "l2_res_er",
          "l3_mkt_hr",
          "l3_sec_hr",
          "l3_sub_hr",
          "l3_mkt_er",
          "l3_sec_er",
          "l3_sub_er",
          "l3_res_er",
          "l1_mkt_beta",
        ],
        "daily",
      );
      if (!latestData) {
        const metadata = await getRiskMetadata();
        const response = NextResponse.json(
          { error: "No metrics found" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
        addMetadataHeaders(response, metadata);
        return response;
      }

      const m = latestData.metrics;
      const sectorEtf = symbolRecord.sector_etf || null;
      const subsectorEtf = symbolRecord.subsector_etf || symbolRecord.sector_etf || null;

      // Link-betas from the cohort store, at the latest date on or before the
      // metric snapshot's date. Null when unreadable or when no such date exists:
      // the basket keeps the leg, reports beta_to_spy and net market β as null,
      // and flags it.
      const linkBetas = await readLatestLinkBetas(
        sectorEtf,
        subsectorEtf,
        market_factor_etf,
        latestData.teo ?? null,
      );

      const basket = buildHedgeBasket({
        lstar_level: m.lstar_level,
        ticker,
        as_of: latestData.teo,
        l1_mkt_hr: m.l1_mkt_hr ?? null,
        l2_mkt_hr: m.l2_mkt_hr ?? null,
        l2_sec_hr: m.l2_sec_hr ?? null,
        l3_mkt_hr: m.l3_mkt_hr ?? null,
        l3_sec_hr: m.l3_sec_hr ?? null,
        l3_sub_hr: m.l3_sub_hr ?? null,
        l2_sec_er: m.l2_sec_er ?? null,
        l3_sub_er: m.l3_sub_er ?? null,
        beta_m_aapl: m.l1_mkt_beta ?? null,
        sector_etf_ticker: sectorEtf,
        subsector_etf_ticker: subsectorEtf,
        market_etf_ticker: market_factor_etf,
        lambda_s_to_m: linkBetas?.lambda_s_to_m ?? null,
        lambda_u_to_m: linkBetas?.lambda_u_to_m ?? null,
        lambda_s_to_m_r2: linkBetas?.lambda_s_to_m_r2 ?? null,
        link_betas_as_of: linkBetas?.teo ?? null,
        user_segment,
      });

      const marketEtf = market_factor_etf ?? "SPY";
      const hedge_levels = buildHedgeLevels(m, {
        market_etf: marketEtf,
        sector_etf: sectorEtf,
        subsector_etf: subsectorEtf,
      }, {
        recommended_level: basket.recommended_hedge_level,
        statistical_lstar: basket.lstar,
      });

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const responseBody = {
        ...basket,
        hedge_levels,
        _metadata: buildMetadataBody(metadata, {
          factors: [marketEtf, sectorEtf, subsectorEtf].filter(Boolean) as string[],
        }),
      };

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
      console.error(`[hedge-basket] Exception for ${ticker}:`, error);
      const metadata = await getRiskMetadata();
      const response = NextResponse.json(
        { error: "Internal server error" },
        { status: 500, headers: getCorsHeaders(origin) },
      );
      addMetadataHeaders(response, metadata);
      return response;
    }
  },
  { capabilityId: "hedge-basket" },
);
