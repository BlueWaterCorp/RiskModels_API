import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  fetchStyleRankings,
  type CohortType,
  type RankPeriodWindow,
  type Weighting,
} from "@/lib/dal/funds-engine";
import { styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

const COHORT_TYPES = new Set<CohortType>(["symbol", "sector", "fund"]);
const PERIOD_WINDOWS = new Set<RankPeriodWindow>(["1m", "3m", "12m", "36m"]);
const WEIGHTINGS = new Set<Weighting>(["ew", "mv"]);

/**
 * GET /api/funds/style/{slug}/rankings/{cohort_type}
 *
 * Top-N rankings within a 9-box style cell × cohort_type × metric ×
 * period_window × weighting. The cohort axis runs over `symbol` (rank
 * holdings), `sector` (rank sector codes), or `fund` (rank funds).
 *
 * Required: ?metric (e.g. "weight", "gross_return"). Defaults: period_window=1m,
 * weighting=mv, limit=25 (capped 50 — Slice 9 storage ceiling).
 *
 * For cohort_type=fund, weighting is ignored (writer stores 'ew' placeholder
 * since fund returns are scalar).
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const cohortType = segments[segments.length - 1] as CohortType;
    const slug = segments[segments.length - 3];

    const cellName = styleSlugToName(slug ?? "");
    if (!cellName) {
      return NextResponse.json(
        { error: `Invalid style slug: ${slug}` },
        { status: 400 },
      );
    }
    if (!cohortType || !COHORT_TYPES.has(cohortType)) {
      return NextResponse.json(
        { error: `cohort_type must be one of: symbol, sector, fund` },
        { status: 400 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const metric = sp.get("metric")?.trim();
    if (!metric) {
      return NextResponse.json(
        { error: "metric query param is required" },
        { status: 400 },
      );
    }

    const periodWindow = (sp.get("period_window") ?? "1m") as RankPeriodWindow;
    if (!PERIOD_WINDOWS.has(periodWindow)) {
      return NextResponse.json(
        { error: "period_window must be one of: 1m, 3m, 12m, 36m" },
        { status: 400 },
      );
    }

    const requestedWeighting = (sp.get("weighting") ?? "mv") as Weighting;
    if (!WEIGHTINGS.has(requestedWeighting)) {
      return NextResponse.json(
        { error: "weighting must be one of: ew, mv" },
        { status: 400 },
      );
    }

    let limit = 25;
    const limitParam = sp.get("limit");
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: "limit must be a positive integer" },
          { status: 400 },
        );
      }
      limit = Math.min(Math.floor(parsed), 50);
    }

    const rows = await fetchStyleRankings(cellName, {
      metric,
      cohortType,
      periodWindow,
      weighting: requestedWeighting,
      limit,
    });

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No rankings available for this (cell, cohort_type, metric, period_window, weighting)",
          equity_style_9box: cellName,
          slug,
          cohort_type: cohortType,
          metric,
          period_window: periodWindow,
        },
        { status: 404 },
      );
    }

    const reportDate = rows[0]!.report_date;
    const filingDateMax = rows[0]!.filing_date_max;
    const effectiveWeighting = rows[0]!.weighting;

    const headers = new Headers({ "X-Data-As-Of": reportDate });
    if (filingDateMax) headers.set("X-Data-Filing-Date", filingDateMax);

    return NextResponse.json(
      {
        equity_style_9box: cellName,
        slug,
        cohort_type: cohortType,
        metric,
        period_window: periodWindow,
        weighting: effectiveWeighting,
        report_date: reportDate,
        filing_date_max: filingDateMax,
        n_returned: rows.length,
        rows: rows.map((r) => ({
          rank: r.rank,
          entity_id: r.entity_id,
          value: r.value,
          cohort_size: r.cohort_size,
        })),
      },
      { headers },
    );
  },
  { capabilityId: "style-cohort-rankings" },
);
