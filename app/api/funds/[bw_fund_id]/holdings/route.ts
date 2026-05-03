import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import { readFundHoldingsTopN } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 1000;

/**
 * GET /api/funds/{bw_fund_id}/holdings?limit=25
 *
 * Top-N current holdings at the fund's latest teo. Reads `ds_ph.zarr`
 * (Slice 5) on GCS — `adj_mv (symbol, teo)` and `aum_erm3 (teo,)`. Each
 * holding includes `bw_sym_id`, `adj_mv`, and `weight = adj_mv / aum_erm3`
 * (null when AUM is null/0).
 *
 * Default `limit = 25` (a page-friendly default per Stage B scope);
 * caller can request up to 1000.
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

    const limitParam = request.nextUrl.searchParams.get("limit");
    let limit = DEFAULT_TOP_N;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: "limit must be a positive integer" },
          { status: 400 },
        );
      }
      limit = Math.min(Math.floor(parsed), MAX_TOP_N);
    }

    const fund = await fetchFund(bwFundId);
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const snapshot = await readFundHoldingsTopN(bwFundId, limit);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "No holdings panel available for this fund",
          bw_fund_id: bwFundId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": snapshot.teo });
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
  { capabilityId: "fund-holdings" },
);
