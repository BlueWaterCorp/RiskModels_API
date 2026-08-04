/**
 * GET /api/cohorts/roster — the addressable cohorts, their parent links, and
 * the variable catalogue. Discovery endpoint: it tells a caller what it may
 * ask for and what the numbers mean, including the no-intercept contract read
 * straight from the store's attrs.
 *
 * Lists the 12 public cohorts only. It is deliberately not a census of the
 * store.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCohortService } from "@/lib/risk/cohort-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    try {
      const fetchStart = performance.now();
      const result = await getCohortService().getRoster();

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Cohort data unavailable" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

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
        { headers: getCorsHeaders(origin) },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "cohorts-roster" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
