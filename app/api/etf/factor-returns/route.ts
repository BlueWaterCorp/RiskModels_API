/**
 * GET /api/etf/factor-returns
 *
 * One-teo snapshot of close + trailing-window returns (1d / 21d / 63d / 252d)
 * for the public-scope factor ETF set: SPY + 11 GICS sector SPDR ETFs.
 *
 * The classification scope is intentionally narrow — GICS sector membership
 * is industry-public knowledge so exposing it carries no leakage on top of
 * what any prospectus already discloses. The fuller ERM3 ETF roster
 * (subsectors, style, macro, broad-market) is NOT exposed through this
 * endpoint by design; see lib/risk/etf-factor-classification.ts.
 *
 * Query params:
 *   sleeve   "market" | "sector" | "all"  (default "all")
 *   tickers  comma-separated list, intersected with the in-scope set
 *   teo      YYYY-MM-DD, default latest teo in ds_etf
 *
 * @see lib/risk/etf-factor-returns-service.ts
 * @see lib/dal/zarr-reader.ts::readEtfFactorReturnsSnapshot
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getEtfFactorReturns } from "@/lib/risk/etf-factor-returns-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  addMetadataHeaders,
  buildMetadataBody,
} from "@/lib/dal/response-headers";
import { EtfFactorReturnsRequestSchema } from "@/lib/api/schemas";
import { isKnownFactorEtf } from "@/lib/risk/etf-factor-classification";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    const { searchParams } = new URL(request.url);

    const validation = EtfFactorReturnsRequestSchema.safeParse({
      sleeve: searchParams.get("sleeve") ?? undefined,
      tickers: searchParams.get("tickers") ?? undefined,
      teo: searchParams.get("teo") ?? undefined,
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

    const { sleeve, tickers, teo } = validation.data;

    // Reject tickers outside the public-scope registry BEFORE hitting the
    // service — surfaces the IP boundary as a clear 400, and prevents the
    // underlying zarr from being probed for ETFs that the API doesn't expose.
    if (tickers) {
      const unknown = tickers.filter((t) => !isKnownFactorEtf(t));
      if (unknown.length) {
        return NextResponse.json(
          {
            error: "Unknown ticker",
            message: `These tickers are not in the public factor-returns scope: ${unknown.join(
              ", ",
            )}. This endpoint covers SPY + 11 GICS sector ETFs only.`,
          },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }
    }

    try {
      const fetchStart = performance.now();
      const result = await getEtfFactorReturns({ sleeve, tickers, teo });

      if (!result) {
        return NextResponse.json(
          {
            error: "Not found",
            message: "Factor returns are unavailable — upstream data store offline.",
          },
          { status: 503, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const fetchLatency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, {
            data_source: "zarr",
            range: [result.teo, result.teo],
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
      console.error(`[EtfFactorReturns]`, errMessage);
      return NextResponse.json(
        {
          error: "Internal Error",
          message: errMessage,
          request_id: context.requestId,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "etf-factor-returns" },
);
