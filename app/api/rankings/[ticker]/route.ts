import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolByTicker,
  fetchRankingsFromSecurityHistory,
  RANKING_WINDOWS,
  RANKING_COHORTS,
  RANKING_METRICS,
  type RankingResult,
} from "@/lib/dal/risk-engine-v3";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { MetricsRequestSchema } from "@/lib/api/schemas";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const dynamic = "force-dynamic";

const WINDOWS = new Set<string>(RANKING_WINDOWS);
const COHORTS = new Set<string>(RANKING_COHORTS);
const METRICS = new Set<string>(RANKING_METRICS);

function withDisplayLabel(rows: RankingResult[]) {
  return rows.map((r) => ({
    ...r,
    display_label: `${r.window} · ${r.cohort} · ${r.metric}`,
  }));
}

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    const rawTicker = request.nextUrl.pathname.split("/").pop();

    const validation = MetricsRequestSchema.safeParse({ ticker: rawTicker });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed ticker",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker } = validation.data;
    const sp = request.nextUrl.searchParams;
    const metricQ = sp.get("metric") ?? undefined;
    const cohortQ = sp.get("cohort") ?? undefined;
    const windowQ = sp.get("window") ?? undefined;

    if (metricQ && !METRICS.has(metricQ)) {
      return NextResponse.json(
        {
          error: "Invalid metric",
          message: `metric must be one of: ${[...METRICS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (cohortQ && !COHORTS.has(cohortQ)) {
      return NextResponse.json(
        {
          error: "Invalid cohort",
          message: `cohort must be one of: ${[...COHORTS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (windowQ && !WINDOWS.has(windowQ)) {
      return NextResponse.json(
        {
          error: "Invalid window",
          message: `window must be one of: ${[...WINDOWS].join(", ")}`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

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

    const fetchStart = performance.now();
    const filters =
      metricQ || cohortQ || windowQ
        ? { metric: metricQ, cohort: cohortQ, window: windowQ }
        : undefined;

    const { teo, rankings } = await fetchRankingsFromSecurityHistory(
      symbolRecord.symbol,
      filters,
    );

    const metadata = await getRiskMetadata();
    const latency = Math.round(performance.now() - fetchStart);

    const rankingsPublic = withDisplayLabel(rankings);

    const format = parseFormat(sp, request.headers.get("accept"));
    if (format !== "json") {
      const csvRows = (rankingsPublic as unknown as Record<string, unknown>[]).map((r) => ({
        ticker: symbolRecord.ticker,
        teo,
        ...r,
      }));
      return formatResponse({
        rows: csvRows,
        format,
        filename: `${ticker}_rankings.csv`,
        extraHeaders: getCorsHeaders(origin) as Record<string, string>,
      });
    }

    const response = NextResponse.json(
      {
        ticker: symbolRecord.ticker,
        symbol: symbolRecord.symbol,
        teo,
        date: teo,
        rankings: rankingsPublic,
        filters: {
          metric: metricQ ?? null,
          cohort: cohortQ ?? null,
          window: windowQ ?? null,
        },
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
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
