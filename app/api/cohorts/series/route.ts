/**
 * GET /api/cohorts/series — cohort residual statistics over a date range.
 *
 * This is the endpoint a consumer uses to demean: request `residual_mean` for
 * the level their residual is defined against and subtract it. The response
 * carries the store's own no-intercept contract text so the reason is never
 * more than one hop away from the data.
 *
 * Each cohort's `proxied_fraction` reports how much of the returned window had
 * its factor computed from a substitute instrument. That is not cosmetic: over
 * the full panel XLC is proxied ~70% of days and XLRE ~59%, so a long-history
 * series for either is materially a different basket for most of its length.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCohortService, UnknownCohortError } from "@/lib/risk/cohort-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { CohortSeriesRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = CohortSeriesRequestSchema.safeParse({
      cohorts: searchParams.get("cohorts") || undefined,
      variables: searchParams.get("variables") || undefined,
      start_date: searchParams.get("start_date") || undefined,
      end_date: searchParams.get("end_date") || undefined,
      min_names: searchParams.get("min_names") || undefined,
      include_proxy_source: searchParams.get("include_proxy_source") || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", message: validation.error.issues[0].message },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { cohorts, variables, start_date, end_date, min_names, include_proxy_source } =
      validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getCohortService().getSeries({
        tickers: cohorts,
        variables,
        startDate: start_date,
        endDate: end_date,
        minNames: min_names,
        includeProxySource: include_proxy_source,
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
          rows: result.cohorts.flatMap((c) =>
            c.points.map((p) => ({
              date: p.date,
              cohort: c.ticker,
              level: c.level,
              parent: c.parent,
              ...p.values,
              ...(p.proxy_source !== undefined ? { proxy_source: p.proxy_source } : {}),
            })),
          ),
          format,
          filename: `cohort_series_${result.range?.[0] ?? "start"}_${result.range?.[1] ?? "end"}.csv`,
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
  { capabilityId: "cohorts-series" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
