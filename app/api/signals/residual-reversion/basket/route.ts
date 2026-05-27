/**
 * POST /api/signals/residual-reversion/basket
 *
 * Aggregate the Phase D residual mean-reversion signal across a user-defined
 * basket of tickers. Returns the weighted aggregate, decile + quality-quintile
 * histograms, and per-member rows.
 *
 * Companion to:
 *   - GET /api/residual-signal/{ticker}      (single-name snapshot + history)
 *   - GET /api/residual-signal/latest        (full universe cross-section)
 *   - GET /api/residual-signal/decile/{n}    (one decile bucket)
 *
 * This endpoint is the basket / portfolio variant — "what does the signal
 * say about THESE 30 names together?"
 *
 * Combo-input building block, NOT a standalone strategy. Every response
 * carries the same capacity_note as the per-ticker surfaces.
 *
 * @see lib/risk/residual-signal-basket-service.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getResidualSignalBasket } from "@/lib/risk/residual-signal-basket-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildMetadataBody,
} from "@/lib/dal/response-headers";
import { ResidualSignalBasketRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getBasketItemCount(
  req: NextRequest,
): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body?.tickers?.length;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const validation = ResidualSignalBasketRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]!.message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { tickers, weights, signal_quality_min_quintile } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getResidualSignalBasket(tickers, {
        weights,
        signal_quality_min_quintile,
      });

      if (!result) {
        return NextResponse.json(
          {
            error: "Not found",
            message: "Residual signal store unavailable.",
          },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range: [result.as_of_date, result.as_of_date],
          }),
        },
        {
          headers: {
            ...getCorsHeaders(origin),
            "X-Data-Fetch-Latency-Ms": String(fetchLatency),
          },
        },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      console.error(`[ResidualSignal/basket]`, errMessage);
      return NextResponse.json(
        {
          error: "Internal Error",
          message: errMessage,
          request_id: context.requestId,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  {
    capabilityId: "residual-signal-basket",
    getItemCount: getBasketItemCount,
  },
);
