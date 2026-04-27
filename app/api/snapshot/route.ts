/**
 * POST /api/snapshot — canonical JSON portfolio snapshot (L3 risk + return attribution).
 *
 * Coexists with GET /api/snapshot/{ticker} (DD assets) in `app/api/snapshot/[ticker]/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { SnapshotRequestSchema } from "@/lib/api/schemas";
import { getCorsHeaders } from "@/lib/cors";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import {
  buildCanonicalPortfolioSnapshot,
  resolveSnapshotPortfolioToWeights,
} from "@/lib/portfolio/canonical-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getPositionCount(request: NextRequest): Promise<number | undefined> {
  try {
    const body = await request.clone().json();
    if (body?.type === "portfolio" && Array.isArray(body.portfolio)) {
      return body.portfolio.length;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export const POST = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", message: "Expected JSON body" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const parsed = SnapshotRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        {
          error: "Invalid request",
          message: first?.message ?? "Validation failed",
          details: parsed.error.issues,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    if (parsed.data.type !== "portfolio") {
      return NextResponse.json(
        { error: "Invalid request", message: "Expected type: portfolio" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    const { portfolio, lookback_days, mode, benchmark } = parsed.data;
    const resolved = await resolveSnapshotPortfolioToWeights(portfolio);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: "Invalid portfolio", message: resolved.error },
        { status: resolved.status, headers: getCorsHeaders(origin) },
      );
    }

    const built = await buildCanonicalPortfolioSnapshot({
      positions: resolved.positions,
      lookbackDays: lookback_days,
      mode,
      benchmark: benchmark ?? null,
    });

    if (!built.ok) {
      return NextResponse.json(
        {
          error: built.error,
          details: built.details,
        },
        { status: built.status, headers: getCorsHeaders(origin) },
      );
    }

    const metadata = await getRiskMetadata();
    const responseBody = {
      ...built.body,
      _metadata: buildMetadataBody(metadata),
      _agent: {
        cost_usd: context.costUsd,
        request_id: context.requestId,
      },
    };

    const res = NextResponse.json(responseBody, {
      headers: getCorsHeaders(origin),
    });
    addMetadataHeaders(res, metadata);
    return res;
  },
  {
    capabilityId: "portfolio-risk-snapshot",
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
