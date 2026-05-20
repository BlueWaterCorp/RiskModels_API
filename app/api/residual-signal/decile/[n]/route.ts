/**
 * GET /api/residual-signal/decile/[n]
 *
 * Phase D residual mean-reversion factor — current members of decile `n`
 * (1 = most negative residual_z_5d / most "oversold", 10 = most positive /
 * most "overbought"), sorted by residual_z_5d.
 *
 * Combo-input building block, not a standalone strategy — see `capacity_note`.
 *
 * @see lib/risk/residual-signal-service.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getResidualSignalDecile } from "@/lib/risk/residual-signal-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const rawN = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");

    const n = Number(rawN);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "decile must be an integer in [1, 10]",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    try {
      const fetchStart = performance.now();
      const result = await getResidualSignalDecile(n);

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
      console.error(`[ResidualSignal/decile]`, errMessage);
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
