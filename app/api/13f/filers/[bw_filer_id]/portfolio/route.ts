import { NextResponse, type NextRequest } from "next/server";
import {
  annotatePortfolioRows,
  missingQuarters,
  normalizeFilerId,
} from "@/lib/13f/filer-portfolio-quality";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import {
  readFilerBookRepairs,
  readFilerDataVintage,
  readFilerPortfolioSeries,
  readFilerVintageQuarters,
} from "@/lib/dal/funds-zarr-reader";

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
 * H.307 (2026-10-06), additive: each row also carries `original_filing_date`,
 * `filing_date_is_amendment`, `n_amendments`, `accession_number`,
 * `is_partial_period` (the last row's forward window has not closed),
 * `is_stub` (returns without a holdings snapshot), `book_complete`,
 * `mapped_share`, `erm3_universe_share`, `repair_status` and
 * `repair_rows_affected`, `repair_detail`; the body adds `missing_quarters`,
 * `data_vintage` and `quality_sources` (`ok` / `unpublished` / `error` per source;
 * `mismatch` with a count when a named book did not match its row).
 *
 * Date params are inclusive and optional.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    // H.307 (7): accept BW-FILER-CIK1067983, CIK1067983, 0001067983 and 1067983 for the same filer.
    const bwFilerId = normalizeFilerId(segments[segments.length - 2]);
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
    // Quarter gaps are a property of the store, not of an as_of view: computed before the as_of filter, then
    // restricted to the returned window.
    const allTeos = rows.map((r) => r.teo);

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

    // H.307 / researcher enhancements 1–2: correctness flags and per-quarter quality fields. A source that is not
    // published leaves its fields null (`unpublished`); a source that fails to read also leaves them null but is
    // reported as `error`, so a client can tell the two apart. Neither fails the request.
    const settle = async <T,>(p: Promise<T | null>): Promise<{ v: T | null; s: "ok" | "unpublished" | "error" }> => {
      try {
        const v = await p;
        return { v, s: v == null ? "unpublished" : "ok" };
      } catch (err) {
        console.error(`[filer portfolio] quality source failed for ${bwFilerId}`, err);
        return { v: null, s: "error" };
      }
    };
    const [vint, rep, dv] = await Promise.all([
      settle(readFilerVintageQuarters(bwFilerId)),
      settle(readFilerBookRepairs(bwFilerId)),
      settle(readFilerDataVintage(bwFilerId)),
    ]);
    // Partial = the row's quarter window ends after the store's returns window_end; null when that was not read.
    const annotated = annotatePortfolioRows(rows, vint.v, rep.v, dv.v?.returns_window_end ?? null);
    const teosSorted = rows.map((r) => r.teo).sort();
    const lo = teosSorted[0]!;
    const hi = teosSorted[teosSorted.length - 1]!;
    const gaps = missingQuarters([...allTeos].sort()).filter((q) => q > lo && q < hi);
    // A row whose named book is not in the vintage store, or whose dates disagree, has its book fields nulled; the
    // source is then reported as `mismatch`, not `ok`.
    const vintStatus =
      vint.s === "ok" && annotated.book_mismatches > 0 ? ("mismatch" as const) : vint.s;

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
        // Quarter-ends strictly inside [start_teo, end_teo] with no book in the store.
        missing_quarters: gaps,
        data_vintage: dv.v,
        quality_sources: {
          vintages: vintStatus,
          repair_ledger: rep.s,
          data_vintage: dv.s,
          book_mismatches: annotated.book_mismatches,
        },
        rows: annotated.rows,
      },
      { headers },
    );
  },
  { capabilityId: "filer-portfolio-history" },
);
