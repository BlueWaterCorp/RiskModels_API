import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getIndustryPanelService, IndustryPanelFactAxisUnavailable } from "@/lib/risk/industry-panel-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { IndustryPanelRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = IndustryPanelRequestSchema.safeParse({
      market_factor_etf: searchParams.get("market_factor_etf") || "SPY",
      teo: searchParams.get("teo") || searchParams.get("date") || undefined,
      level: searchParams.get("level") || undefined,
      by: searchParams.get("by") || undefined,
      min_peers: searchParams.get("min_peers") || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { market_factor_etf, teo, level, by, min_peers } = validation.data;

    try {
      const fetchStart = performance.now();
      const service = getIndustryPanelService();
      const result = await service.getPanel(market_factor_etf, {
        teo,
        level,
        minPeers: min_peers,
        by,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Not found", message: "Industry panel data unavailable" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        return formatResponse({
          rows: result.industries.map((row) => ({
            teo: result.teo,
            market_factor_etf: result.market_factor_etf,
            ...row,
          })),
          format,
          filename: `industry_panel_${result.teo}.csv`,
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
      if (err instanceof IndustryPanelFactAxisUnavailable) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: 409, headers: getCorsHeaders(origin) },
        );
      }
      const message = err instanceof Error ? err.message : "Internal error";
      return NextResponse.json(
        { error: "Internal error", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "industry-panel" },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
