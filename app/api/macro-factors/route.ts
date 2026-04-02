import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { fetchMacroFactorSeriesRows } from "@/lib/dal/macro-factors";
import { parseMacroFactorsSeriesQuery } from "@/lib/api/macro-factors-series-query";

export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    try {
      const parsed = parseMacroFactorsSeriesQuery(request.nextUrl.searchParams);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: "Invalid request", message: parsed.message },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      const fetchStart = performance.now();
      const metadata = await getRiskMetadata();
      const { rows, warnings, factors_requested } = await fetchMacroFactorSeriesRows(
        parsed.factorStrings,
        parsed.start,
        parsed.end,
      );

      const mergedWarnings = [...warnings];
      if (rows.length === 0 && mergedWarnings.length === 0) {
        mergedWarnings.push(
          "No rows in macro_factors for this date range and factor list.",
        );
      }

      const latency = Math.round(performance.now() - fetchStart);
      const response = NextResponse.json({
        factors_requested,
        start: parsed.start,
        end: parsed.end,
        row_count: rows.length,
        series: rows,
        warnings: mergedWarnings,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          latency_ms: latency,
          request_id: context.requestId,
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[macro-factors] GET failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Macro factors handler failed", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "macro-factor-series" },
);
