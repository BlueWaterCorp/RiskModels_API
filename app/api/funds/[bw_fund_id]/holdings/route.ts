import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { isCalendarDate } from "@/lib/api/schemas";
import { fetchFund } from "@/lib/dal/funds-engine";
import {
  readFundHoldingsBook,
  readFundHoldingsTopN,
  type FundHoldingsTimeBasis,
} from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const DEFAULT_TOP_N = 25;
const MAX_TOP_N = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/funds/{bw_fund_id}/holdings?limit=25&as_of=YYYY-MM-DD&time_basis=report_date
 *
 * The fund's full book at its latest report date, shorts included (negative
 * `adj_mv`), from the per-fund `ds_ph.zarr` on GCS. Ranked by |adj_mv|; each
 * holding has `bw_sym_id`, `ticker`, `adj_mv` and a signed
 * `weight` against reported net assets (gross value when unavailable). `book`
 * gives long/short/net/gross totals over
 * every position, whatever `limit` is. Default `limit = 25`, max 5000.
 *
 * An undated request falls back to the precomputed top-25 longs
 * (`fund_holdings_top`) when the fund has no ds_ph.zarr; dated requests never
 * fall forward. `source` says which store answered.
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

    const asOfParam = request.nextUrl.searchParams.get("as_of");
    if (asOfParam !== null && (!ISO_DATE.test(asOfParam) || !isCalendarDate(asOfParam))) {
      return NextResponse.json(
        { error: "as_of must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const asOf = asOfParam ?? undefined;

    const timeBasisRaw = request.nextUrl.searchParams.get("time_basis");
    if (asOf && timeBasisRaw === null) {
      // A dated request must say which clock it means. The two answers differ by
      // the filing lag (Contrafund's 2020-06-30 book was filed 2020-08-20), and a
      // silent report_date default would hand a backtest a book nobody had yet.
      return NextResponse.json(
        {
          error: "time_basis is required when as_of is set",
          code: "time_basis_required",
          detail:
            "as_of can mean two different books. report_date returns the book the fund " +
            "reported for the latest period ending on or before as_of, even if it was " +
            "filed later. available_date returns the latest book whose filing date is on " +
            "or before as_of, i.e. what an outsider could have known that day.",
          options: {
            report_date: "Book for the period ending on or before as_of (may be filed after as_of).",
            available_date: "Book filed on or before as_of (no look-ahead).",
          },
          examples: [
            `?as_of=${asOf}&time_basis=report_date`,
            `?as_of=${asOf}&time_basis=available_date`,
          ],
        },
        { status: 400 },
      );
    }
    const timeBasisParam = timeBasisRaw ?? "report_date";
    if (timeBasisParam !== "report_date" && timeBasisParam !== "available_date") {
      return NextResponse.json(
        { error: "time_basis must be report_date or available_date" },
        { status: 400 },
      );
    }
    const timeBasis = timeBasisParam as FundHoldingsTimeBasis;

    const fund = await fetchFund(bwFundId);
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const book = await readFundHoldingsBook(bwFundId, limit, asOf, timeBasis);
    // The fallback table is latest-only. It remains part of the undated route,
    // but cannot answer a point-in-time request without risking a fall-forward.
    const snapshot = book ?? (asOf ? null : await readFundHoldingsTopN(bwFundId, limit));
    if (!snapshot) {
      return NextResponse.json(
        {
          error: asOf
            ? "No holdings exist for this fund at or before the requested date"
            : "No holdings panel available for this fund",
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
        report_date: book?.report_date ?? snapshot.teo,
        filing_date: filingDate ?? null,
        time_basis: book?.time_basis ?? timeBasis,
        ticker_as_of: "current_registry",
        ...snapshot,
      },
      { headers },
    );
  },
  { capabilityId: "fund-holdings" },
);
