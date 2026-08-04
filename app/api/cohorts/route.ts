/**
 * GET /api/cohorts — one-teo cross-section of cohort residual statistics.
 *
 * Public scope is SPY + the 11 GICS sector SPDRs. The L3 subsector cohorts in
 * the underlying store are proprietary and not addressable here; requesting one
 * returns the same 400 as a nonexistent ticker, by design.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCohortService, UnknownCohortError } from "@/lib/risk/cohort-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { CohortCrossSectionRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = CohortCrossSectionRequestSchema.safeParse({
      cohorts: searchParams.get("cohorts") || undefined,
      variables: searchParams.get("variables") || undefined,
      teo: searchParams.get("teo") || searchParams.get("date") || undefined,
      min_names: searchParams.get("min_names") || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { cohorts, variables, teo, min_names } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getCohortService().getCrossSection({
        tickers: cohorts,
        variables,
        teo,
        minNames: min_names,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Cohort data unavailable" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        return formatResponse({
          rows: result.cohorts.map((row) => ({
            teo: result.teo,
            cohort: row.ticker,
            level: row.level,
            parent: row.parent,
            ...row.values,
          })),
          format,
          filename: `cohorts_${result.teo}.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

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
      if (err instanceof UnknownCohortError) {
        return NextResponse.json(
          {
            error: "Invalid request",
            message: `Unknown cohort '${err.ticker}'. Addressable cohorts are SPY and the 11 GICS sector SPDR ETFs.`,
          },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "cohorts" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
