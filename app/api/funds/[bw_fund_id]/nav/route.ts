import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundNavSeries } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/funds/{bw_fund_id}/nav?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Per-fund NAV time series from Funds_DAG's `ds_nav.zarr` on GCS. One row per
 * teo (month-end) with `nav_close` (resampled month-end close) and
 * `nav_return_monthly` (pct_change of consecutive month-end closes). Date
 * params are inclusive and optional (default = the full panel for this fund).
 *
 * Pairs with `/portfolio`: portfolio returns are derived from quarterly 13F
 * holdings, NAV returns are what investors actually realised. The gap
 * surfaces intra-quarter trading, fees, and cash drag not visible in 13F.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFundId = segments[segments.length - 2];
    if (!bwFundId) {
      return NextResponse.json(
        { error: "bw_fund_id is required" },
        { status: 400 },
      );
    }

    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get("start_date") ?? undefined;
    const endDate = searchParams.get("end_date") ?? undefined;
    if (startDate && !ISO_DATE.test(startDate)) {
      return NextResponse.json(
        { error: "start_date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (endDate && !ISO_DATE.test(endDate)) {
      return NextResponse.json(
        { error: "end_date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json(
        { error: "start_date must be <= end_date" },
        { status: 400 },
      );
    }

    const fund = await fetchFund(bwFundId);
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const rows = await readFundNavSeries(bwFundId, { startDate, endDate });
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No NAV history available for this fund",
          bw_fund_id: bwFundId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({
      "X-Data-As-Of": rows[rows.length - 1]!.teo,
    });
    if (fund.latest_filing_date) {
      headers.set("X-Data-Filing-Date", fund.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_fund_id: bwFundId,
        ticker: fund.ticker,
        fund_name: fund.fund_name,
        equity_style_9box: fund.equity_style_9box,
        n_periods: rows.length,
        start_teo: rows[0]!.teo,
        end_teo: rows[rows.length - 1]!.teo,
        rows,
      },
      { headers },
    );
  },
  { capabilityId: "fund-nav-history" },
);
