/**
 * POST /api/portfolio/exposure — signed long/short book exposure and L3 risk.
 *
 * Takes signed dollar positions (short < 0, up to 1000) and returns beta-dollars,
 * the ETF hedge trades at L1/L2/L3, and an L3 risk split: systematic risk from
 * the book's raw-ETF exposure × ETF covariance, plus a diagonal approximation of
 * residual risk. ETFs held in the book count as exposure to themselves. By
 * default each name is hedged at its own L* level (`hedge_level: "lstar"`).
 *
 * Math: lib/portfolio/signed-exposure.ts. Loading: lib/portfolio/signed-exposure-data.ts.
 * Unlike /portfolio/risk-index, nothing is normalised or weight-averaged.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { PortfolioExposureRequestSchema } from "@/lib/api/schemas";
import { computePortfolioExposure } from "@/lib/portfolio/signed-exposure-data";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Distinct tickers submitted: sets the price tier for the pre-flight balance check. */
async function getItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const body = await req.clone().json();
    if (!Array.isArray(body?.positions)) return undefined;
    return new Set(
      body.positions.map((p: { ticker?: unknown }) => String(p?.ticker ?? "").toUpperCase()),
    ).size;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Body must be valid JSON" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = PortfolioExposureRequestSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { positions, lookback_days, hedge_level, as_of } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await computePortfolioExposure(positions, {
        lookbackDays: lookback_days,
        basis: hedge_level,
        asOf: as_of,
      });

      if ("error" in result) {
        // Nothing in the book resolved to a modelled name: a 4xx, so not billed.
        return NextResponse.json(
          {
            error: "No modelled positions",
            message: "None of the submitted positions has ERM3 risk metrics.",
            dropped: result.dropped,
          },
          { status: 422, headers: getCorsHeaders(origin) },
        );
      }

      // Bill the tier for names actually modelled (stocks plus ETFs held), not
      // names submitted: dropped tickers never push a book into the higher tier.
      context.setBillableItemCount?.(result.book.modelled_stocks + result.book.direct_etfs);

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);
      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _agent: {
            cost_usd: context.costUsd,
            request_id: context.requestId,
            latency_ms: latency,
          },
        },
        {
          headers: {
            ...getCorsHeaders(origin),
            "X-Data-Fetch-Latency-Ms": String(latency),
          },
        },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[portfolio/exposure] failed:", err);
      return NextResponse.json(
        { error: "Internal error", message: "Exposure computation failed" },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "portfolio-exposure", getItemCount },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
