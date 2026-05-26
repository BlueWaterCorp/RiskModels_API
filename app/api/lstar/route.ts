import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getLstarService } from "@/lib/risk/lstar-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { LstarRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { parseFormat, formatResponse } from "@/lib/api/format-response";

export const runtime = "nodejs";

function classifyLstarError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("zarr") || m.includes("gcs")) return "zarr_read_failed";
  if (m.includes("registry") || m.includes("metric_key")) return "registry_resolve_failed";
  if (m.includes("supabase") || m.includes("postgres")) return "supabase_query_failed";
  if (m.includes("timeout") || m.includes("aborted")) return "upstream_timeout";
  if (m.includes("network") || m.includes("econnreset")) return "network_error";
  return "internal_error";
}

/**
 * GET /api/lstar
 *
 * Per-(ticker, date) recommended hedge-level series with the chosen level's
 * dispatched hedge ratios. The selection rule:
 *
 *   if L3_subsector_ER >= θ → L3 (3-ETF hedge)
 *   elif L2_sector_ER  >= θ → L2 (2-ETF hedge)
 *   else                   → L1 (market hedge only)
 *
 * θ defaults to 1% (chat-safe). SDK callers can override via `?threshold=`.
 *
 * Response carries the lstar string per date, the chosen level's market /
 * sector / subsector HRs (nulls below the chosen level), the chosen level's
 * daily residual return (`residual_return`), and the raw ER inputs
 * (`l2_sector_er`, `l3_subsector_er`) so callers can audit or apply their
 * own threshold without a second request.
 */
export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");

    const validation = LstarRequestSchema.safeParse({
      ticker: searchParams.get("ticker"),
      market_factor_etf: searchParams.get("market_factor_etf") || "SPY",
      years: searchParams.get("years") || "1",
      threshold: searchParams.get("threshold"),
    });

    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]!.message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { ticker, market_factor_etf, years, threshold } = validation.data;

    try {
      const fetchStart = performance.now();
      const service = getLstarService();
      const result = await service.getLstar(ticker, market_factor_etf, {
        years,
        threshold,
      });

      if (!result) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const format = parseFormat(searchParams, request.headers.get("accept"));
      if (format !== "json") {
        const resultAny = result as unknown as Record<string, unknown>;
        const dates = resultAny.dates as string[];
        const csvRows = dates.map((date: string, i: number) => {
          const row: Record<string, unknown> = { ticker: result.ticker, date };
          for (const [key, val] of Object.entries(resultAny)) {
            if (key === "ticker" || key === "dates") continue;
            if (Array.isArray(val)) row[key] = (val as unknown[])[i];
          }
          return row;
        });
        return formatResponse({
          rows: csvRows,
          format,
          filename: `${result.ticker}_lstar.csv`,
          extraHeaders: getCorsHeaders(origin) as Record<string, string>,
        });
      }

      const d = result.dates;
      const histRange: [string, string] | undefined =
        d.length > 0 ? [d[0]!, d[d.length - 1]!] : undefined;

      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range: histRange,
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
      const errClass = classifyLstarError(errMessage);
      console.error(
        `[Lstar] ${errClass} for ticker=${ticker} years=${years} threshold=${threshold}:`,
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
  { capabilityId: "lstar" },
);
