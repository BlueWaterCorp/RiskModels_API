/**
 * GET /api/residual-signal/[ticker]
 *
 * Phase D residual mean-reversion factor for a single ticker: the latest
 * signal reading plus a calendar-day history window (default 90d).
 *
 * The signal is the L3 orthogonal residual's 5-day mean-reversion factor —
 * a combo-input building block for multi-signal alpha stacks, NOT a
 * standalone strategy. Every response carries `capacity_note` with the
 * explicit gross-Sharpe + market-impact capacity disclosure.
 *
 * @see lib/risk/residual-signal-service.ts
 * @see BWMACRO/research/phase_b_minimum_experiment_results.md
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getResidualSignalForTicker } from "@/lib/risk/residual-signal-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { ResidualSignalTickerRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("zarr") || m.includes("gcs")) return "zarr_read_failed";
  if (m.includes("timeout") || m.includes("aborted")) return "upstream_timeout";
  if (m.includes("network") || m.includes("econnreset")) return "network_error";
  return "internal_error";
}

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const rawTicker = request.nextUrl.pathname.split("/").pop();
    const origin = request.headers.get("origin");

    const validation = ResidualSignalTickerRequestSchema.safeParse({
      ticker: rawTicker,
      days: request.nextUrl.searchParams.get("days") ?? undefined,
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

    const { ticker, days } = validation.data;

    try {
      const fetchStart = performance.now();
      const result = await getResidualSignalForTicker(ticker, days);

      if (!result) {
        return NextResponse.json(
          {
            error: "Not found",
            message: `No residual signal for ticker ${ticker} (not in the active universe, or insufficient history).`,
          },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range:
              result.history.length > 0
                ? [
                    result.history[0]!.date,
                    result.history[result.history.length - 1]!.date,
                  ]
                : undefined,
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
      const errClass = classifyError(errMessage);
      console.error(
        `[ResidualSignal] ${errClass} for ticker=${ticker} days=${days}:`,
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
  { capabilityId: "residual-signal" },
);
