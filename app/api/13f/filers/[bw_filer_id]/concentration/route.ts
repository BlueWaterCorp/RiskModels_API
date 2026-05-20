import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { fetchFiler } from "@/lib/dal/filers-engine";
import { readFilerConcentrationSummary } from "@/lib/dal/funds-zarr-reader";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/13f/filers/{bw_filer_id}/concentration?start_date=&end_date=
 *
 * Quarter-end concentration panel from per-filer ds_portfolio.zarr on GCS.
 * Returns median and latest effective N, top-5 / top-10 weight share, and
 * weight HHI over the optional date window (same underlying series as
 * /portfolio, summarized for §3-style diligence).
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

    const summary = await readFilerConcentrationSummary(bwFilerId, {
      startDate,
      endDate,
    });
    if (!summary) {
      return NextResponse.json(
        {
          error: "No concentration panel available for this filer",
          bw_filer_id: bwFilerId,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": summary.end_teo });
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
        ...summary,
      },
      { headers },
    );
  },
  { capabilityId: "filer-concentration" },
);
