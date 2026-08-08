/**
 * GET /api/cohorts/variance-shares — peer variance shares for a cohort.
 *
 * The comparison behind "is this manager picking stocks, or hugging its
 * index?". Returns MEAN market / sector / subsector / residual shares across
 * the cohort, built from the same per-name `l3_*_er` fields the single-entity
 * decomposition renders — so an entity bar and a peer bar are one construction
 * rather than two.
 *
 * Deliberately NOT served from the cohort store: `cohort_ER` there is an
 * incremental attribution that can be negative and does not sum to 1, which is
 * a different quantity and cannot sit beneath a variance-share bar.
 *
 *   ?cohort=XBI              required — the sector or subsector ETF proxy
 *   ?level=subsector|sector  required — which classification to match on
 *   ?exclude=NVDA-US         optional — drop the subject from its own peer set
 *
 * Thin cohorts are refused with 422 rather than returned, mirroring the cohort
 * store's guidance that statistics on a cohort with few members are noise.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  getCohortVarianceShares,
  ThinCohortError,
  MIN_COHORT_MEMBERS,
  type CohortLevel,
} from "@/lib/risk/cohort-variance-shares-service";
import { getRiskMetadata } from "@/lib/dal/risk-metadata";
import { buildMetadataBody } from "@/lib/dal/response-headers";
import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COHORT_RE = /^[A-Za-z]{1,8}$/;

export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = new URL(request.url);
    const origin = request.headers.get("origin");
    const cors = getCorsHeaders(origin);

    const cohort = searchParams.get("cohort")?.trim() ?? "";
    const levelRaw = searchParams.get("level")?.trim().toLowerCase() ?? "";
    const exclude = searchParams.get("exclude")?.trim() || null;

    if (!COHORT_RE.test(cohort)) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "cohort is required and must be an ETF ticker, e.g. XBI",
        },
        { status: 400, headers: cors },
      );
    }
    if (levelRaw !== "sector" && levelRaw !== "subsector") {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "level is required and must be 'sector' or 'subsector'",
        },
        { status: 400, headers: cors },
      );
    }
    const level = levelRaw as CohortLevel;

    try {
      const started = performance.now();
      const result = await getCohortVarianceShares({
        cohort,
        level,
        excludeSymbol: exclude,
      });
      const metadata = await getRiskMetadata();

      return NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, { data_source: "supabase" }),
          _latency_ms: Math.round(performance.now() - started),
        },
        { headers: cors },
      );
    } catch (error) {
      if (error instanceof ThinCohortError) {
        // 422, not 404: the cohort exists, the statistic is refused. A consumer
        // must be able to tell "no such cohort" from "too thin to report".
        return NextResponse.json(
          {
            error: "Cohort too thin",
            message: error.message,
            cohort: error.cohort,
            n_names: error.nNames,
            min_names: MIN_COHORT_MEMBERS,
          },
          { status: 422, headers: cors },
        );
      }
      console.error("[cohorts/variance-shares] failed:", error);
      return NextResponse.json(
        { error: "Internal error", message: "Cohort variance shares unavailable" },
        { status: 500, headers: cors },
      );
    }
  },
  // Billed under the existing cohorts capability: same population, same
  // discovery surface, and a separate id would fragment the entitlement.
  { capabilityId: "cohorts" },
);

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
