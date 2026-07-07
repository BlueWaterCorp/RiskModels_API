import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readFilerPortfolioSeries } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/13f/filers/{bw_filer_id}/portfolio?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&as_of=YYYY-MM-DD
 *
 * Per-filer portfolio time series from per-filer ds_portfolio.zarr on GCS.
 * Returns one row per teo (quarter-end) with diagnostics (weight_sum,
 * n_holdings_active, effective_n, top10_weight_sum), AUM (total_aum_usd,
 * aum_in_erm3), ERM3 coverage diagnostics, and portfolio style attribution
 * fields. Return components are NULL until D.8 Phase 2.
 *
 * D.8.39: each row carries its `filing_date` (knowledge-time stamp; null on
 * pre-1.4-schema zarrs). `as_of` filters to rows *known* by that date —
 * `filing_date <= as_of` when per-teo filing dates exist, else
 * `teo <= as_of` (basis echoed as `as_of_basis`).
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

    const asOf = searchParams.get("as_of") ?? undefined;
    if (asOf && !ISO_DATE.test(asOf)) {
      return NextResponse.json(
        { error: "as_of must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const filer = await fetchFiler(bwFilerId);
    if (!filer) {
      return NextResponse.json({ error: "Filer not found" }, { status: 404 });
    }

    let rows = await readFilerPortfolioSeries(bwFilerId, { startDate, endDate });

    // D.8.39 knowledge mode: keep rows known by as_of. Basis is per-panel —
    // filing_date when the zarr carries it, report_date (teo) otherwise.
    let asOfBasis: "filing_date" | "report_date" | undefined;
    if (asOf && rows.length > 0) {
      const hasFilingDates = rows.some((r) => r.filing_date != null);
      asOfBasis = hasFilingDates ? "filing_date" : "report_date";
      rows = hasFilingDates
        ? rows.filter((r) => r.filing_date != null && r.filing_date <= asOf)
        : rows.filter((r) => r.teo <= asOf);
    }
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: asOf
            ? "No portfolio history was known for this filer as of the requested date"
            : "No portfolio history available for this filer",
          bw_filer_id: bwFilerId,
          ...(asOf ? { as_of: asOf } : {}),
        },
        { status: 404 },
      );
    }

    const lastRow = rows[rows.length - 1]!;
    const headers = new Headers({
      "X-Data-As-Of": lastRow.teo,
    });
    if (lastRow.filing_date) {
      headers.set("X-Data-Filing-Date", lastRow.filing_date);
    } else if (!asOf && filer.latest_filing_date) {
      headers.set("X-Data-Filing-Date", filer.latest_filing_date);
    }

    return NextResponse.json(
      {
        bw_filer_id: bwFilerId,
        cik: filer.cik,
        name: filer.name,
        filer_type: filer.filer_type,
        aum_tier: filer.aum_tier,
        ...(asOf ? { as_of: asOf, as_of_basis: asOfBasis } : {}),
        n_periods: rows.length,
        start_teo: rows[0]!.teo,
        end_teo: lastRow.teo,
        rows,
      },
      { headers },
    );
  },
  { capabilityId: "filer-portfolio-history" },
);
