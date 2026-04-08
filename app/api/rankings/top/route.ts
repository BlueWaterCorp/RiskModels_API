import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import {
  fetchTopRankingsSnapshot,
  RANKING_WINDOWS,
  RANKING_COHORTS,
  RANKING_METRICS,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const dynamic = "force-dynamic";

const WINDOWS = new Set<string>(RANKING_WINDOWS);
const COHORTS = new Set<string>(RANKING_COHORTS);
const METRICS = new Set<string>(RANKING_METRICS);

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    const sp = request.nextUrl.searchParams;
    const metricQ = sp.get("metric");
    const cohortQ = sp.get("cohort");
    const windowQ = sp.get("window");
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 10;

    if (!metricQ || !METRICS.has(metricQ)) {
      return NextResponse.json(
        {
          error: "Invalid metric",
          message: `metric is required and must be one of: ${[...METRICS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (!cohortQ || !COHORTS.has(cohortQ)) {
      return NextResponse.json(
        {
          error: "Invalid cohort",
          message: `cohort is required and must be one of: ${[...COHORTS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (!windowQ || !WINDOWS.has(windowQ)) {
      return NextResponse.json(
        {
          error: "Invalid window",
          message: `window is required and must be one of: ${[...WINDOWS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: "Invalid limit",
          message: "limit must be an integer between 1 and 100",
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const fetchStart = performance.now();
    const { teo, rows } = await fetchTopRankingsSnapshot({
      metric: metricQ,
      cohort: cohortQ,
      window: windowQ,
      limit,
    });

    const metadata = await getRiskMetadata();
    const latency = Math.round(performance.now() - fetchStart);

    const format = parseFormat(sp, request.headers.get("accept"));
    if (format !== "json") {
      return formatResponse({
        rows: rows as unknown as Record<string, unknown>[],
        format,
        filename: `rankings_${metricQ}_${cohortQ}_${windowQ}.csv`,
        extraHeaders: getCorsHeaders(origin) as Record<string, string>,
      });
    }

    const response = NextResponse.json(
      {
        teo,
        metric: metricQ,
        cohort: cohortQ,
        window: windowQ,
        limit,
        rankings: rows,
        _metadata: buildMetadataBody(metadata),
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
  },
  { capabilityId: "rankings" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
