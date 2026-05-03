import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  fetchStyleCohortLatest,
  fetchStyleRankings,
} from "@/lib/dal/funds-engine";
import {
  readStyleCohortHoldingsTopN,
  readStyleCohortPortfolioSeries,
} from "@/lib/dal/funds-zarr-reader";
import { composeCohortSnapshot } from "@/lib/funds/snapshot-composer";
import { styleSlugToName, styleSlugToPathComponent } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

const HOLDINGS_TOP_N = 25;
const TOP_FUNDS_LIMIT = 10;
const TOP_SYMBOLS_LIMIT = 15;
const COHORT_LOOKBACK_MONTHS = 12;

/**
 * GET /api/funds/style/{slug}/snapshot
 *
 * The "differentiated wedge" — composed cohort snapshot for one of the 9-box
 * style cells. Assembles cohort metrics (EW + MV) + top-25 cohort holdings
 * (MV) + 12-month cohort portfolio history (EW + MV) + top-10 funds in cell
 * + top-15 symbols in cell. Morningstar reports per-fund metrics but doesn't
 * render this cohort-aggregate surface.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    // Path: /api/funds/style/{slug}/snapshot — slug is the second-to-last segment.
    const slug = segments[segments.length - 2];
    const cellName = styleSlugToName(slug ?? "");
    const pathComponent = styleSlugToPathComponent(slug ?? "");
    if (!cellName || !pathComponent) {
      return NextResponse.json(
        { error: `Invalid style slug: ${slug}` },
        { status: 400 },
      );
    }

    const cohortMetrics = await fetchStyleCohortLatest(cellName);
    if (cohortMetrics.length === 0) {
      return NextResponse.json(
        {
          error: "No cohort metrics available for this cell",
          equity_style_9box: cellName,
          slug,
        },
        { status: 404 },
      );
    }

    // Compute the 12-month start window from the latest report_date in the cohort.
    const latestReport = cohortMetrics
      .map((m) => m.report_date)
      .sort()
      .pop()!;
    const reportDate = new Date(`${latestReport}T12:00:00Z`);
    const startWindow = new Date(reportDate);
    startWindow.setUTCMonth(
      startWindow.getUTCMonth() - COHORT_LOOKBACK_MONTHS - 1,
    );
    const startDate = startWindow.toISOString().slice(0, 10);

    const [topFunds, topSymbols, portfolioHistory, cohortHoldings] =
      await Promise.all([
        fetchStyleRankings(cellName, {
          metric: "portfolio_gross_return",
          cohortType: "fund",
          periodWindow: "12m",
          limit: TOP_FUNDS_LIMIT,
        }),
        fetchStyleRankings(cellName, {
          metric: "weight",
          cohortType: "symbol",
          periodWindow: "1m",
          weighting: "mv",
          limit: TOP_SYMBOLS_LIMIT,
        }),
        readStyleCohortPortfolioSeries(pathComponent, {
          startDate,
          endDate: latestReport,
        }),
        readStyleCohortHoldingsTopN(pathComponent, {
          weighting: "mv",
          n: HOLDINGS_TOP_N,
        }),
      ]);

    const snapshot = composeCohortSnapshot({
      cellName,
      slug,
      cohortMetrics,
      topFunds,
      topSymbols,
      portfolioHistory,
      cohortHoldings,
    });

    if (!snapshot) {
      return NextResponse.json(
        {
          error: "Cohort snapshot composition produced no rows",
          equity_style_9box: cellName,
          slug,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.report_date });
    if (snapshot.filing_date_max) {
      headers.set("X-Data-Filing-Date", snapshot.filing_date_max);
    }
    if (snapshot._metadata.model_version) {
      headers.set("X-Risk-Model-Version", snapshot._metadata.model_version);
    }

    return NextResponse.json(snapshot, { headers });
  },
  { capabilityId: "style-cohort-snapshot-json" },
);
