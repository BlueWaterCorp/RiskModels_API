import { NextResponse, type NextRequest } from "next/server";
import { normalizeFilerId } from "@/lib/13f/filer-portfolio-quality";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readDailyReturnsCube } from "@/lib/dal/funds-zarr-reader";
import { buildActualHistory, parseActualHistoryWindow } from "@/lib/portfolio/actual-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/13f/filers/{bw_filer_id}/attribution-history?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Daily return attribution of the filer's reported 13F books (market, sector,
 * subsector, residual), weights changing at each report date. `history_kind:
 * "actual"`, `time_basis: "period_of_report"`. The series starts at
 * `first_reliable_date`, set by the coverage rule in `first_reliable_rule`;
 * sessions outside the rule after that date carry null legs. `coverage` is the
 * covered share of the book each session and `book_report_date` the report
 * date of the book in force.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFilerId = normalizeFilerId(segments[segments.length - 2]);
    if (!bwFilerId) {
      return NextResponse.json({ error: "bw_filer_id is required" }, { status: 400 });
    }
    const parsed = parseActualHistoryWindow(request.nextUrl.searchParams);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const filer = await fetchFiler(bwFilerId);
    if (!filer) return NextResponse.json({ error: "Filer not found" }, { status: 404 });

    const cube = await readDailyReturnsCube("filer", bwFilerId);
    const history = cube ? buildActualHistory("filer", cube, parsed.window) : null;
    if (!history) {
      return NextResponse.json(
        {
          error: cube
            ? "No session of this filer's reported history meets the coverage rule in the requested window"
            : "No attribution history available for this filer",
          bw_filer_id: bwFilerId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": history.end_date });
    if (filer.latest_filing_date) headers.set("X-Data-Filing-Date", filer.latest_filing_date);
    return NextResponse.json(
      {
        bw_filer_id: bwFilerId,
        cik: filer.cik,
        name: filer.name,
        ...history,
      },
      { headers },
    );
  },
  { capabilityId: "filer-attribution-history" },
);
