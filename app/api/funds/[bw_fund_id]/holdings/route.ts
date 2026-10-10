import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFund } from "@/lib/dal/funds-engine";
import {
  readFundHoldingsBook,
  readFundHoldingsTopN,
} from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 5000;

/**
 * GET /api/funds/{bw_fund_id}/holdings?limit=25
 *
 * The fund's full book at its latest report date, shorts included (negative
 * `adj_mv`), from the per-fund `ds_ph.zarr` on GCS. Ranked by |adj_mv|; each
 * holding has `bw_sym_id`, `ticker`, `adj_mv` and a signed
 * `weight = adj_mv / aum_erm3`. `book` gives long/short/net/gross totals over
 * every position, whatever `limit` is. Default `limit = 25`, max 5000.
 *
 * Falls back to the precomputed top-25 longs (`fund_holdings_top`) when the
 * fund has no ds_ph.zarr; `source` says which one answered.
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

    const book = await readFundHoldingsBook(bwFundId, limit);
    const snapshot = book ?? (await readFundHoldingsTopN(bwFundId, limit));
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
    const filingDate = book?.filing_date ?? fund.latest_filing_date;
    if (filingDate) {
      headers.set("X-Data-Filing-Date", filingDate);
    }

    return NextResponse.json(
      {
        bw_fund_id: bwFundId,
        ticker: fund.ticker,
        fund_name: fund.fund_name,
        equity_style_9box: fund.equity_style_9box,
        source: book ? "full_book" : "top_25_longs",
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "fund-holdings" },
);
