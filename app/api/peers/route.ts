import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { addMetadataHeaders, buildMetadataBody } from "@/lib/dal/response-headers";
import {
  fetchPeersByTicker,
  type PeerGroupBy,
} from "@/lib/dal/risk-engine-v3";

export const dynamic = "force-dynamic";

function parseGroupBy(raw: string | null): PeerGroupBy | undefined {
  if (raw === "sector_etf" || raw === "subsector_etf") return raw;
  return undefined;
}

export const GET = withBilling(
  async (request: NextRequest, context: BillingContext) => {
    const origin = request.headers.get("origin");
    const params = request.nextUrl.searchParams;
    const ticker = (params.get("ticker") || "").trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        { error: "Invalid request", message: "Query parameter 'ticker' is required" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    const groupBy = parseGroupBy(params.get("group_by"));
    const limitRaw = params.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limitRaw && (!Number.isFinite(limit) || (limit as number) < 1)) {
      return NextResponse.json(
        { error: "Invalid request", message: "'limit' must be a positive integer" },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }

    try {
      const fetchStart = performance.now();
      const result = await fetchPeersByTicker({
        ticker,
        groupBy,
        limit: limit as number | undefined,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Symbol not found", message: `Ticker '${ticker}' not found` },
          { status: 404, headers: getCorsHeaders(origin) },
        );
      }

      const metadata = await getRiskMetadata();
      const latency = Math.round(performance.now() - fetchStart);

      const response = NextResponse.json({
        ticker: result.target.ticker,
        target: result.target,
        group_by: result.group_by,
        group_etf: result.group_etf,
        peers: result.peers,
        peer_count: result.peers.length,
        warnings: result.warnings,
        _metadata: buildMetadataBody(metadata),
        _agent: {
          cost_usd: context.costUsd,
          request_id: context.requestId,
          latency_ms: latency,
        },
      });
      addMetadataHeaders(response, metadata);
      return response;
    } catch (err) {
      console.error("[peers] GET failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Peers handler failed", message },
        { status: 500, headers: getCorsHeaders(origin) },
      );
    }
  },
  { capabilityId: "peers" },
);

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
