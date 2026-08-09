/**
 * GET /api/cohorts/residual-leadership — rank cohort members by cumulative
 * L3 residual (stock-specific) return over a window.
 *
 *   ?cohort=SMH              required — sector or subsector ETF proxy
 *   ?window=252d             required — trailing window (Nd); resolved window
 *                            must have ≥ ~200 observations or the call 422s
 *   ?level=subsector|sector  optional — default subsector (SMH/XBI-style)
 *
 * Thin cohorts and short windows → 422. Unknown cohort → 404. Never a partial
 * ranking table: the consumer treats 422 as a clean refusal and a malformed
 * 200 as a defect.
 */

import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  getCohortResidualLeadership,
  ThinCohortError,
  ShortWindowError,
  UnknownCohortError,
  parseWindowDays,
  MIN_COHORT_MEMBERS,
  MIN_WINDOW_OBS,
  type CohortLevel,
} from "@/lib/risk/cohort-residual-leadership-service";
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
    const window = searchParams.get("window")?.trim() ?? "";
    const levelRaw = searchParams.get("level")?.trim().toLowerCase() || "subsector";

    if (!COHORT_RE.test(cohort)) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "cohort is required and must be an ETF ticker, e.g. SMH",
        },
        { status: 400, headers: cors },
      );
    }
    if (parseWindowDays(window) == null) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "window is required and must look like '252d'",
        },
        { status: 400, headers: cors },
      );
    }
    if (levelRaw !== "sector" && levelRaw !== "subsector") {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "level must be 'sector' or 'subsector'",
        },
        { status: 400, headers: cors },
      );
    }
    const level = levelRaw as CohortLevel;

    try {
      const started = performance.now();
      const result = await getCohortResidualLeadership({
        cohort,
        window,
        level,
      });
      const metadata = await getRiskMetadata();

      return NextResponse.json(
        {
          ...result,
          _metadata: buildMetadataBody(metadata, { data_source: "zarr" }),
          _latency_ms: Math.round(performance.now() - started),
        },
        { headers: cors },
      );
    } catch (error) {
      if (error instanceof UnknownCohortError) {
        return NextResponse.json(
          {
            error: "Not found",
            message: error.message,
            cohort: error.cohort,
          },
          { status: 404, headers: cors },
        );
      }
      if (error instanceof ThinCohortError) {
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
      if (error instanceof ShortWindowError) {
        return NextResponse.json(
          {
            error: "Window too short",
            message: error.message,
            cohort: error.cohort,
            obs: error.obs,
            min_obs: MIN_WINDOW_OBS,
          },
          { status: 422, headers: cors },
        );
      }
      console.error("[cohorts/residual-leadership] failed:", error);
      return NextResponse.json(
        { error: "Internal error", message: "Cohort residual leadership unavailable" },
        { status: 500, headers: cors },
      );
    }
  },
  // Same capability as variance-shares: peer population, same entitlement.
  { capabilityId: "cohorts" },
);

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
