import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundHedgeLatest } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/{bw_fund_id}/hedge
 *
 * Latest L1/L2/L3 hedge ratios for a fund. Reads `L{1,2,3}_HR (teo, symbol)`
 * from Slice 7's per-fund `ds_hr.zarr` at the latest teo, drops NaN entries,
 * returns per-level ETF lists. Trailing teos with no hedge (past ds_ph's
 * forward-fill cap) are skipped; `holdings_teo` is the report date of the
 * filed holdings behind the weights, which can be months before `teo`.
 * Most ETFs only have a non-NaN HR at the level
 * where they were the matched factor ETF — empty levels are still emitted as
 * empty arrays for consistent shape.
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

    const fund = await fetchFund(bwFundId);
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const snapshot = await readFundHedgeLatest(bwFundId);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "No hedge ratio panel available for this fund",
          bw_fund_id: bwFundId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.teo });
    if (snapshot.holdings_teo) {
      headers.set("X-Holdings-As-Of", snapshot.holdings_teo);
    }
    if (fund.latest_filing_date) {
      headers.set("X-Data-Filing-Date", fund.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_fund_id: bwFundId,
        ticker: fund.ticker,
        fund_name: fund.fund_name,
        equity_style_9box: fund.equity_style_9box,
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "fund-hedge" },
);
