import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readFilerPortfolioSeries } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/13f/filers/{bw_filer_id}/portfolio?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Per-filer portfolio time series from per-filer ds_portfolio.zarr on GCS.
 * Returns one row per teo (quarter-end) with diagnostics (weight_sum,
 * n_holdings_active, effective_n, top10_weight_sum), AUM (total_aum_usd,
 * aum_in_erm3), ERM3 coverage diagnostics, and portfolio style attribution
 * fields. Return components are NULL until D.8 Phase 2.
 *
 * Date params are inclusive and optional.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFilerId = segments[segments.length - 2];
    if (!bwFilerId) {
      return NextResponse.json(
        { error: "bw_filer_id is required" },
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

    const filer = await fetchFiler(bwFilerId);
    if (!filer) {
      return NextResponse.json({ error: "Filer not found" }, { status: 404 });
    }

    const rows = await readFilerPortfolioSeries(bwFilerId, { startDate, endDate });
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No portfolio history available for this filer",
          bw_filer_id: bwFilerId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({
      "X-Data-As-Of": rows[rows.length - 1]!.teo,
    });
    if (filer.latest_filing_date) {
      headers.set("X-Data-Filing-Date", filer.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_filer_id: bwFilerId,
        cik: filer.cik,
        name: filer.name,
        filer_type: filer.filer_type,
        aum_tier: filer.aum_tier,
        n_periods: rows.length,
        start_teo: rows[0]!.teo,
        end_teo: rows[rows.length - 1]!.teo,
        rows,
      },
      { headers },
    );
  },
  { capabilityId: "filer-portfolio-history" },
);
