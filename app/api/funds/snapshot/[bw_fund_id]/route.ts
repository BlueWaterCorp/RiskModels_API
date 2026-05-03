import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import {
  fetchFundCohortRanks,
  fetchStyleCohortLatest,
  resolveFundById,
} from "@/lib/dal/funds-engine";
import {
  readFundHedgeLatest,
  readFundHoldingsTopN,
  readFundNavSeries,
  readFundPortfolioSeries,
} from "@/lib/dal/funds-zarr-reader";
import { composeFundSnapshot } from "@/lib/funds/snapshot-composer";

export const dynamic = "force-dynamic";

const HOLDINGS_TOP_N = 25;
const FUND_LOOKBACK_MONTHS = 12;

/**
 * GET /api/funds/snapshot/{bw_fund_id}
 *
 * Composed JSON snapshot — assembles registry + latest metrics + top-N
 * holdings + L1/L2/L3 hedge + 12-month portfolio time series + cohort
 * context (fund's rank within its 9-box cell on every metric the rankings
 * table covers). All sub-fetches run in parallel.
 *
 * Public-facing analytical surface; the matching `.pdf` endpoint (Stage
 * D.2) renders this same composition to a 1-page tearsheet server-side.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFundId = segments[segments.length - 1];
    if (!bwFundId) {
      return NextResponse.json(
        { error: "bw_fund_id is required" },
        { status: 400 },
      );
    }

    const resolved = await resolveFundById(bwFundId);
    if (!resolved) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }
    if (!resolved.latest) {
      return NextResponse.json(
        {
          error: "No funds_latest row for this fund",
          bw_fund_id: bwFundId,
        },
        { status: 404 },
      );
    }
    const { fund, latest } = resolved;

    // 12-month window start, computed against the latest report_date.
    const reportDate = new Date(`${latest.report_date}T12:00:00Z`);
    const startWindow = new Date(reportDate);
    startWindow.setUTCMonth(
      startWindow.getUTCMonth() - FUND_LOOKBACK_MONTHS - 1,
    );
    const startDate = startWindow.toISOString().slice(0, 10);

    const cohortMetricsP = fund.equity_style_9box
      ? fetchStyleCohortLatest(fund.equity_style_9box)
      : Promise.resolve([]);

    const [holdings, hedge, portfolioHistory, navHistory, cohortRanks, cohortMetrics] =
      await Promise.all([
        readFundHoldingsTopN(bwFundId, HOLDINGS_TOP_N),
        readFundHedgeLatest(bwFundId),
        readFundPortfolioSeries(bwFundId, {
          startDate,
          endDate: latest.report_date,
        }),
        readFundNavSeries(bwFundId, {
          startDate,
          endDate: latest.report_date,
        }),
        fetchFundCohortRanks(bwFundId),
        cohortMetricsP,
      ]);

    const snapshot = composeFundSnapshot({
      fund,
      latest,
      holdings,
      hedge,
      portfolioHistory,
      navHistory,
      cohortRanks,
      cohortMetrics,
    });

    const headers = new Headers({
      "X-Data-As-Of": latest.report_date,
      "X-Data-Filing-Date": latest.filing_date,
    });
    if (latest.model_version) {
      headers.set("X-Risk-Model-Version", latest.model_version);
    }

    return NextResponse.json(snapshot, { headers });
  },
  { capabilityId: "fund-snapshot-json" },
);
