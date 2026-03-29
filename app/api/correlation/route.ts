import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { FactorCorrelationRequestSchema } from "@/lib/api/schemas";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import {
  computeFactorCorrelation,
  computeFactorCorrelationBatch,
  DEFAULT_MACRO_FACTORS,
} from "@/lib/risk/factor-correlation-service";

export const dynamic = "force-dynamic";

async function getCorrelationItemCount(req: NextRequest): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = await clone.json();
    const t = body?.ticker;
    return Array.isArray(t) ? t.length : 1;
  } catch {
    return undefined;
  }
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    try {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid request body", message: "Expected JSON body" },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      const validation = FactorCorrelationRequestSchema.safeParse(raw);
      if (!validation.success) {
        return NextResponse.json(
          {
            error: "Invalid request",
            message: validation.error.issues[0]?.message ?? "Validation failed",
          },
          { status: 400, headers: getCorsHeaders(origin) },
        );
      }

      const { ticker, factors, return_type, window_days, method } = validation.data;
      const factorList = factors?.length ? factors : [...DEFAULT_MACRO_FACTORS];

      const fetchStart = performance.now();
      const metadata = await getRiskMetadata();

      if (Array.isArray(ticker)) {
        const { results } = await computeFactorCorrelationBatch(ticker, {
          factors: factorList,
          return_type,
          window_days,
          method,
        });
        const latency = Math.round(performance.now() - fetchStart);
        const response = NextResponse.json({
          results,
          _metadata: buildMetadataBody(metadata),
          _agent: {
            latency_ms: latency,
            request_id: context.requestId,
          },
        });
        addMetadataHeaders(response, metadata);
        return response;
      }

      const result = await computeFactorCorrelation({
        ticker,
        factors: factorList,
        return_type,
        window_days,
        method,
      });

      if ("error" in result && "status" in result) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status, headers: getCorsHeaders(origin) },
        );
      }

      const latency = Math.round(performance.now() - fetchStart);
      const response = NextResponse.json({
        ...result,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          latency_ms: latency,
          request_id: context.requestId,
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[correlation] POST failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Correlation handler failed",
          message,
        },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "factor-correlation", getItemCount: getCorrelationItemCount },
);
