import { NextRequest, NextResponse } from "next/server";
import { withBilling, BillingContext } from "@/lib/agent/billing-middleware";
import { getCorsHeaders } from "@/lib/cors";
import {
  resolveSymbolByTicker,
  fetchRankingsFromSecurityHistory,
  RANKING_WINDOWS,
  RANKING_COHORTS,
  RANKING_METRICS,
} from "@/lib/dal/risk-engine-v3";
import { MetricsRequestSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

const WINDOWS = new Set<string>(RANKING_WINDOWS);
const COHORTS = new Set<string>(RANKING_COHORTS);
const METRICS = new Set<string>(RANKING_METRICS);

const DEFAULT_METRIC = "subsector_residual";
const DEFAULT_COHORT = "subsector";
const DEFAULT_WINDOW = "252d";

/** Shields.io Endpoint badge JSON (https://shields.io/documentation/json). */
function shieldsJson(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

function formatBadgeMessage(percentile: number): string {
  const rounded = Math.round(percentile * 10) / 10;
  if (percentile >= 90) {
    const topPct = Math.max(1, Math.ceil(100 - percentile));
    return `Top ${topPct}% (${rounded})`;
  }
  return `${rounded} pct`;
}

function badgeColor(percentile: number): string {
  if (percentile >= 80) return "brightgreen";
  if (percentile >= 50) return "yellow";
  if (percentile >= 25) return "orange";
  return "red";
}

async function handleBadge(
  request: NextRequest,
  _context: BillingContext,
  tickerParam: string,
): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const secret = process.env.RANKINGS_BADGE_TOKEN;
  if (secret) {
    const tok = request.nextUrl.searchParams.get("token");
    if (tok !== secret) {
      return shieldsJson(
        { schemaVersion: 1, isError: true, label: "rank", message: "unauthorized" },
        401,
        origin,
      );
    }
  }

  const validation = MetricsRequestSchema.safeParse({ ticker: tickerParam });
  if (!validation.success) {
    return shieldsJson(
      {
        schemaVersion: 1,
        isError: true,
        label: "rank",
        message: "bad ticker",
      },
      400,
      origin,
    );
  }

  const { ticker } = validation.data;
  const sp = request.nextUrl.searchParams;
  const metricQ = sp.get("metric") ?? DEFAULT_METRIC;
  const cohortQ = sp.get("cohort") ?? DEFAULT_COHORT;
  const windowQ = sp.get("window") ?? DEFAULT_WINDOW;

  if (!METRICS.has(metricQ)) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "bad metric" },
      400,
      origin,
    );
  }
  if (!COHORTS.has(cohortQ)) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "bad cohort" },
      400,
      origin,
    );
  }
  if (!WINDOWS.has(windowQ)) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "bad window" },
      400,
      origin,
    );
  }

  const symbolRecord = await resolveSymbolByTicker(ticker);
  if (!symbolRecord) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "not found" },
      404,
      origin,
    );
  }

  const { rankings } = await fetchRankingsFromSecurityHistory(symbolRecord.symbol, {
    metric: metricQ,
    cohort: cohortQ,
    window: windowQ,
  });

  const row = rankings.find(
    (r) => r.metric === metricQ && r.cohort === cohortQ && r.window === windowQ,
  );
  if (!row) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "no data" },
      404,
      origin,
    );
  }

  const p = row.rank_percentile;
  if (p == null || typeof p !== "number" || !Number.isFinite(p)) {
    return shieldsJson(
      { schemaVersion: 1, isError: true, label: "rank", message: "no data" },
      404,
      origin,
    );
  }

  const smallN =
    row.cohort_size != null &&
    typeof row.cohort_size === "number" &&
    row.cohort_size > 0 &&
    row.cohort_size < 10;

  const label = `rank ${windowQ}`;
  const message = formatBadgeMessage(p) + (smallN ? " · small N" : "");

  return shieldsJson(
    {
      schemaVersion: 1,
      label,
      message,
      color: smallN ? "yellow" : badgeColor(p),
    },
    200,
    origin,
  );
}

const badgeRpm = Number.parseInt(process.env.RANKINGS_BADGE_IP_RPM ?? "120", 10);
const effectiveBadgeRpm = Number.isFinite(badgeRpm) && badgeRpm > 0 ? badgeRpm : 120;

export async function GET(
  request: NextRequest,
  segmentData: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await segmentData.params;
  return withBilling(
    (req, ctx) => handleBadge(req, ctx, ticker),
    {
      capabilityId: "rankings-badge",
      skipBilling: true,
      publicIpRateLimitPerMinute: effectiveBadgeRpm,
    },
  )(request);
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) });
}
