/**
 * GET /api/residual-signal/latest
 *
 * Phase D residual mean-reversion factor — full active-universe cross-section
 * at the latest teo, sorted by residual_z_5d ascending (most "oversold"
 * first), paginated via ?limit (default 500, max 2000) and ?offset.
 *
 * Combo-input building block, not a standalone strategy — see `capacity_note`.
 *
 * @see lib/risk/residual-signal-service.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getResidualSignalLatest } from "@/lib/risk/residual-signal-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { ResidualSignalLatestRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = ResidualSignalLatestRequestSchema.safeParse({
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
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

    const { limit, offset } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getResidualSignalLatest({ limit, offset });

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Residual signal store unavailable." },
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
      console.error(`[ResidualSignal/latest]`, errMessage);
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
  { capabilityId: "residual-signal" },
);
