import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { PortfolioRiskIndexRequestSchema } from "@/lib/api/schemas";
import { dispatchWebhookEvent } from "@/lib/api/webhooks";
import { getCorsHeaders } from "@/lib/cors";
import { runPortfolioRiskComputation } from "@/lib/portfolio/portfolio-risk-core";

export const dynamic = "force-dynamic";

async function getPositionCount(req: NextRequest): Promise<number | undefined> {
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body.positions?.length;
  } catch {
    return undefined;
  }
}

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

    const validation = PortfolioRiskIndexRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: validation.error.issues[0].message,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const { positions, timeSeries, years } = validation.data;

    if (positions.length === 0) {
      const metadata = await getRiskMetadata();
      const body = {
        status: "syncing" as const,
        message:
          "No holdings loaded yet. If you just linked a brokerage (e.g. Plaid), wait for the initial sync to finish.",
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
          request_id: context.requestId,
        },
      };
      const response = NextResponse.json(body, {
        headers: {
          ...getCorsHeaders(origin),
          "X-Data-Fetch-Latency-Ms": "0",
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    }

    const core = await runPortfolioRiskComputation(positions, {
      timeSeries,
      years,
      includeHedgeRatios: false,
    });

    if (core.status === "invalid") {
      return NextResponse.json(
        {
          error: "No valid positions",
          message: "None of the provided tickers could be resolved",
          errors: core.errors,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    if (core.status !== "ok") {
      return NextResponse.json(
        { error: "Unexpected portfolio state" },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }

    const metadata = await getRiskMetadata();
    const portfolioER = core.portfolioER;
    const systematic = core.systematic;

    const responseBody: Record<string, unknown> = {
      portfolio_risk_index: {
        variance_decomposition: {
          market: portfolioER.market,
          sector: portfolioER.sector,
          subsector: portfolioER.subsector,
          residual: portfolioER.residual,
          systematic,
        },
        portfolio_volatility_23d: core.portfolioVol,
        position_count: core.summary.resolved,
      },
      per_ticker: core.perTicker,
      summary: {
        total_positions: core.summary.total_positions,
        resolved: core.summary.resolved,
        errors: core.summary.errors,
      },
      _agent: { cost_usd: context.costUsd, request_id: context.requestId },
      _metadata: buildMetadataBody(metadata),
    };

    if (core.errorsList.length > 0) {
      responseBody.errors = core.errorsList;
    }

    if (core.timeSeriesData) {
      responseBody.time_series = core.timeSeriesData;
    }

    const response = NextResponse.json(responseBody, {
      headers: {
        ...getCorsHeaders(origin),
        "X-Data-Fetch-Latency-Ms": String(core.fetchLatencyMs),
      },
    });
    addMetadataHeaders(response, metadata);

    void dispatchWebhookEvent(context.userId, "batch.completed", {
      request_id: context.requestId,
      format: "json",
      summary: {
        total: core.summary.total_positions,
        resolved: core.summary.resolved,
        errors: core.summary.errors,
      },
    }).catch((err) =>
      console.error("[Portfolio/risk-index] webhook dispatch", err),
    );

    return response;
  },
  {
    capabilityId: "portfolio-risk-index",
    getItemCount: getPositionCount,
  },
);

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
