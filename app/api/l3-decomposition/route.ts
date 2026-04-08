import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getL3DecompositionService } from "@/lib/risk/l3-decomposition-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { L3DecompositionRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = L3DecompositionRequestSchema.safeParse({
      ticker: searchParams.get("ticker"),
      market_factor_etf: searchParams.get("market_factor_etf") || "SPY",
      years: searchParams.get("years") || "1",
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

    const { ticker, market_factor_etf } = validation.data;

    try {
      const fetchStart = performance.now();
      const service = getL3DecompositionService();
      const result = await service.getDecomposition(ticker, market_factor_etf);

      if (!result) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        // Pivot parallel arrays into rows: { date, l3_mkt_hr, l3_sec_hr, ... }
        const resultAny = result as unknown as Record<string, unknown>;
        const dates = resultAny.dates as string[];
        const csvRows = dates.map((date: string, i: number) => {
          const row: Record<string, unknown> = { ticker, date };
          for (const [key, val] of Object.entries(resultAny)) {
            if (key === "ticker" || key === "dates") continue;
            if (Array.isArray(val)) row[key] = (val as unknown[])[i];
          }
          return row;
        });
        return formatResponse({
          rows: csvRows,
          format,
          filename: `${ticker}_l3_decomposition.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

      const response = NextResponse.json({
        ...result,
        _metadata: buildMetadataBody(metadata),
      }, {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": String(fetchLatency),
        }
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (e) {
      console.error("[L3 Decomposition] Error:", e);
      return NextResponse.json({ error: "Internal Error" }, { status: 500 });
    }
  },
  { capabilityId: "l3-decomposition" },
);
