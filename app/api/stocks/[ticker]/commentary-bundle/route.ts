/**
 * GET /api/stocks/{ticker}/commentary-bundle
 *
 *   ?window=252d   optional — trailing window for return record + residual rank
 *
 * One pull for the stock-commentary evidence surface: metrics + hedge_levels,
 * return-record summary, cohort standing, peer variance shares, and residual
 * leadership for the name. Thin cohorts / short windows null those pieces
 * rather than 422 the whole response.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  getStockCommentaryBundle,
  parseWindowDays,
} from "@/lib/risk/stock-commentary-bundle-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";
import { MetricsRequestSchema } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const origin = request.headers.get("origin");
    const cors = getCorsHeaders(origin);

    // /api/stocks/{ticker}/commentary-bundle
    const parts = request.nextUrl.pathname.split("/").filter(Boolean);
    const rawTicker = parts[parts.length - 2];

    const validation = MetricsRequestSchema.safeParse({ ticker: rawTicker });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Malformed ticker",
          message: validation.error.issues[0]?.message ?? "invalid ticker",
        },
        { status: 400, headers: cors },
      );
    }

    const window =
      request.nextUrl.searchParams.get("window")?.trim().toLowerCase() || "252d";
    if (parseWindowDays(window) == null) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "window must look like '252d'",
        },
        { status: 400, headers: cors },
      );
    }

    try {
      const started = performance.now();
      const bundle = await getStockCommentaryBundle({
        ticker: validation.data.ticker,
        window,
      });
      if (!bundle) {
        return NextResponse.json(
          { error: "Not found", message: `No metrics for ${validation.data.ticker}` },
          { status: 404, headers: cors },
        );
      }

      const metadata = await getRiskMetadata();
      return NextResponse.json(
        {
          ...bundle,
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _latency_ms: Math.round(performance.now() - started),
        },
        { headers: cors },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes("invalid window")) {
        return NextResponse.json(
          { error: "Invalid request", message: msg },
          { status: 400, headers: cors },
        );
      }
      console.error("[stocks/commentary-bundle] failed:", error);
      return NextResponse.json(
        { error: "Internal error", message: "Stock commentary bundle unavailable" },
        { status: 500, headers: cors },
      );
    }
  },
  // Priced like cohorts: one request replaces metrics + returns + rankings +
  // two cohort reads. Keep under the same entitlement family as peer stats.
  { capabilityId: "cohorts" },
);

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
