import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import {
  getReturnsDecompositionService,
  toReturnsDecompositionPublicBody,
} from "@/lib/risk/returns-decomposition-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildAgentBody,
  buildMetadataBody,
  EMPTY_HISTORY_DATA_WARNING,
} from "@/lib/dal/response-headers";
import { ReturnsDecompositionRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";

function classifyReturnsDecompositionError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("zarr") || m.includes("gcs")) return "zarr_read_failed";
  if (m.includes("registry") || m.includes("metric_key")) return "registry_resolve_failed";
  if (m.includes("supabase") || m.includes("postgres")) return "supabase_query_failed";
  if (m.includes("timeout") || m.includes("aborted")) return "upstream_timeout";
  if (m.includes("network") || m.includes("econnreset")) return "network_error";
  return "internal_error";
}

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const includeLstarRaw = searchParams.get("include_lstar");
    const dispatchRaw = searchParams.get("dispatch");
    const includeLstar =
      includeLstarRaw === "true" ||
      includeLstarRaw === "1" ||
      dispatchRaw === "lstar";

    const validation = ReturnsDecompositionRequestSchema.safeParse({
      ticker: searchParams.get("ticker"),
      market_factor_etf: searchParams.get("market_factor_etf") || "SPY",
      years: searchParams.get("years") || "1",
      include_lstar: includeLstar,
      threshold: searchParams.get("threshold"),
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

    const { ticker, market_factor_etf, years, threshold } = validation.data;

    try {
      const fetchStart = performance.now();
      const service = getReturnsDecompositionService();
      const result = await service.getDecomposition(ticker, market_factor_etf, {
        years,
        includeLstar,
        threshold,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Not found" },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const publicBody = toReturnsDecompositionPublicBody(result);
      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        const resultAny = publicBody as unknown as Record<string, unknown>;
        const dates = resultAny.dates as string[];
        const csvRows = dates.map((date: string, i: number) => {
          const row: Record<string, unknown> = { ticker, date };
          for (const [key, val] of Object.entries(resultAny)) {
            if (key === "ticker" || key === "dates" || key === "threshold_used") {
              continue;
            }
            if (Array.isArray(val)) row[key] = (val as unknown[])[i];
          }
          return row;
        });
        return formatResponse({
          rows: csvRows,
          format,
          filename: `${ticker}_returns_decomposition.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

      const d = publicBody.dates;
      const histRange: [string, string] | undefined =
        d.length > 0 ? [d[0]!, d[d.length - 1]!] : undefined;

      const response = NextResponse.json(
        {
          ...publicBody,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range: histRange,
            history_row_count: d.length,
            ...(d.length === 0 ? { data_warning: EMPTY_HISTORY_DATA_WARNING } : {}),
          }),
          _agent: buildAgentBody({
            request_id: context.requestId,
            cost_usd: context.costUsd,
          }),
        },
        {
          headers: {
            ...getCorsHeaders(origin),
            "X-Data-Fetch-Latency-Ms": String(fetchLatency),
          },
        },
      );
      addMetadataHeaders(response, metadata);
      return response;
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      const errClass = classifyReturnsDecompositionError(errMessage);
      console.error(
        `[Returns Decomposition] ${errClass} for ticker=${ticker} years=${years}:`,
        errMessage,
      );
      return NextResponse.json(
        {
          error: "Internal Error",
          error_class: errClass,
          message: errMessage,
          request_id: context.requestId,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "returns-decomposition" },
);
