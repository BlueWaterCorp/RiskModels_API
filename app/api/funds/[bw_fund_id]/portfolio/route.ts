import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundPortfolioSeries } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/funds/{bw_fund_id}/portfolio?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Per-fund portfolio time series from Slice 8's `ds_portfolio.zarr` on GCS.
 * Returns one row per teo (month-end) with the five return components,
 * `identity_residual`, and the four diagnostics. Date params are inclusive
 * and optional (default = the full panel for this fund).
 *
 * The registry row from `public.funds` is the existence check — we 404 fast
 * when the fund isn't tracked, before paying the GCS open cost.
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

    const rows = await readFundPortfolioSeries(bwFundId, { startDate, endDate });
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No portfolio history available for this fund",
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
  { capabilityId: "fund-portfolio-history" },
);
