/**
 * Reliability Metrics Endpoint
 *
 * Public, aggregate, privacy-safe service reliability for agents that route on
 * measured performance: latency percentiles (p50/p95/p99) and a 5xx-only
 * success rate over a window, plus a per-capability breakdown.
 *
 * Distinct from /api/health (current up/degraded/down state) and from
 * /api/metrics/{ticker} (risk metrics for a security). Numbers here are
 * measured from real traffic — nothing is asserted that isn't observed.
 *
 * GET /api/status?window_hours=24
 */

import { NextResponse } from "next/server";
import { getServiceReliability } from "@/lib/agent/telemetry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const param = Number(new URL(req.url).searchParams.get("window_hours"));
  // Clamp to a sane range; default 24h. Max 30 days.
  const windowHours =
    Number.isFinite(param) && param > 0 ? Math.min(param, 720) : 24;

  try {
    const reliability = await getServiceReliability(windowHours);
    return NextResponse.json(reliability, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[Status] Failed to compute reliability metrics:", error);
    return NextResponse.json(
      { error: "Failed to compute reliability metrics" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
