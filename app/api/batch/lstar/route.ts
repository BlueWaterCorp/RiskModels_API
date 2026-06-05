import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { BatchLstarRequestSchema } from "@/lib/api/schemas";
import { formatResponse } from "@/lib/api/format-response";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";
import {
  batchLstarToLongRows,
  fetchBatchLstar,
} from "@/lib/risk/batch-lstar-service";
import { dispatchWebhookEvent } from "@/lib/api/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getBatchItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body.tickers?.length;
  } catch {
    return undefined;
  }
}

/**
 * POST /api/batch/lstar
 *
 * Batch Lstar-dispatched residual return + hedge level per date for up to 100 tickers.
 * Cost: $0.005/ticker, minimum $0.01/call (25% cheaper than repeated GET /lstar).
 */
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

    const validation = BatchLstarRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0]!.message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const {
      tickers,
      market_factor_etf,
      years,
      threshold,
      axis,
      format: reqFormat,
    } = validation.data;

    const fetchStart = performance.now();
    const body = await fetchBatchLstar({
      tickers: tickers.map((t) => t.toUpperCase()),
      marketFactorEtf: market_factor_etf,
      years,
      threshold,
      axis,
    });
    const metadata = await getRiskMetadata();
    const fetchLatency = Math.round(performance.now() - fetchStart);

    const format =
      reqFormat === "parquet" || reqFormat === "csv" ? reqFormat : "json";

    if (format !== "json") {
      const rows = batchLstarToLongRows(body);
      const response = await formatResponse({
        rows,
        format,
        filename: `batch_lstar_${tickers.length}tickers.${format}`,
        extraHeaders: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": String(fetchLatency),
        } as Record<string, string>,
      });
      addMetadataHeaders(response, metadata);
      void dispatchWebhookEvent(context.userId, "batch.completed", {
        request_id: context.requestId,
        format,
        summary: body.summary,
        ticker_count: tickers.length,
      }).catch((err) => console.error("[Batch/lstar] webhook dispatch", err));
      return response;
    }

    const response = NextResponse.json(
      {
        ...body,
        _agent: { cost_usd: context.costUsd, request_id: context.requestId },
        _metadata: buildMetadataBody(metadata),
      },
      {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": String(fetchLatency),
        },
      },
    );
    addMetadataHeaders(response, metadata);
    void dispatchWebhookEvent(context.userId, "batch.completed", {
      request_id: context.requestId,
      format: "json",
      summary: body.summary,
      ticker_count: tickers.length,
    }).catch((err) => console.error("[Batch/lstar] webhook dispatch", err));
    return response;
  },
  {
    capabilityId: "batch-lstar",
    getItemCount: getBatchItemCount,
  },
);
