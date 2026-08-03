/**
 * POST /api/cohorts/pnl-decomposition — selection vs drift.
 *
 * Splits a book's realized residual return into the part earned by holding
 * better-than-cohort-average names (selection) and the part earned purely by
 * net exposure to the cohort's average residual (drift). The two sum to the
 * total exactly — it is an identity, not a fitted attribution.
 *
 * See lib/risk/cohort-pnl-service.ts for the algebra and the framing rules.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCohortPnlService } from "@/lib/risk/cohort-pnl-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { CohortPnlDecompositionRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const validation = CohortPnlDecompositionRequestSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { positions, level, start_date, end_date, min_names, include_series } =
      validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getCohortPnlService().decompose(positions, {
        level,
        startDate: start_date,
        endDate: end_date,
        minNames: min_names,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Cohort data unavailable" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      // The daily series is the bulky part and most callers only want the
      // totals; it ships only when asked for.
      const body = include_series ? result : { ...result, series: undefined };
      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json(
        {
          ...body,
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
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "cohorts-pnl-decomposition" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
