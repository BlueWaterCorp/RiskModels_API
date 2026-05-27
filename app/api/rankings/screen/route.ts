import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRankingsScreenService } from "@/lib/risk/rankings-screen-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { RankingsScreenRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const validation = RankingsScreenRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const {
      metric,
      cohort,
      window,
      as_of,
      min_percentile,
      decile,
      sector_filter,
      limit,
    } = validation.data;

    try {
      const fetchStart = performance.now();
      const service = getRankingsScreenService();
      const result = await service.screen({
        metric,
        cohort,
        window,
        as_of,
        min_percentile,
        decile,
        sector_filter,
        limit,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Rankings screen data unavailable" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(
        new URLSearchParams(),
        request.headers.get("accept"),
      );
      if (format !== "json") {
        return formatResponse({
          rows: result.rankings.map((row) => ({
            teo: result.teo,
            metric: result.metric,
            cohort: result.cohort,
            window: result.window,
            ...row,
          })),
          format,
          filename: `rankings_screen_${metric}_${cohort}_${window}.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

      const response = NextResponse.json(
        {
          ...result,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "rankings-screen" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
