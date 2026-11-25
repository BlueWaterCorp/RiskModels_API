import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import { readDailyReturnsCube } from "@/lib/dal/funds-zarr-reader";
import { buildActualHistory, parseActualHistoryWindow } from "@/lib/portfolio/actual-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/{bw_fund_id}/attribution-history?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Daily return attribution of the fund's reported books (market, sector,
 * subsector, residual), weights changing at each report date. `history_kind:
 * "actual"`, `time_basis: "period_of_report"`. The series starts at
 * `first_reliable_date`, set by the coverage rule in `first_reliable_rule`;
 * sessions outside the rule after that date carry null legs. `coverage` is the
 * priced share of the book each session.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFundId = segments[segments.length - 2];
    if (!bwFundId) {
      return NextResponse.json({ error: "bw_fund_id is required" }, { status: 400 });
    }
    const parsed = parseActualHistoryWindow(request.nextUrl.searchParams);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const fund = await fetchFund(bwFundId);
    if (!fund) return NextResponse.json({ error: "Fund not found" }, { status: 404 });

    const cube = await readDailyReturnsCube("fund", bwFundId);
    const history = cube ? buildActualHistory("fund", cube, parsed.window) : null;
    if (!history) {
      return NextResponse.json(
        {
          error: cube
            ? "No session of this fund's reported history meets the coverage rule in the requested window"
            : "No attribution history available for this fund",
          bw_fund_id: bwFundId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": history.end_date });
    if (fund.latest_filing_date) headers.set("X-Data-Filing-Date", fund.latest_filing_date);
    return NextResponse.json(
      {
        bw_fund_id: bwFundId,
        ticker: fund.ticker,
        fund_name: fund.fund_name,
        ...history,
      },
      { headers },
    );
  },
  { capabilityId: "fund-attribution-history" },
);
