import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { readStyleCohortPortfolioSeries } from "@/lib/dal/funds-zarr-reader";
import { styleSlugToName, styleSlugToPathComponent } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/funds/style/{slug}/portfolio?start_date=&end_date=
 *
 * Per-cell cohort portfolio time series from Slice 6's
 * `portfolio_style/{Cell_Name}/ds_portfolio.zarr` on GCS. Each row carries
 * both `ew` and `mv` blocks side-by-side for the same teo. Optional inclusive
 * date params trim the panel; default = full history.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const slug = segments[segments.length - 2];
    const cellName = styleSlugToName(slug ?? "");
    const pathComponent = styleSlugToPathComponent(slug ?? "");
    if (!cellName || !pathComponent) {
      return NextResponse.json(
        { error: `Invalid style slug: ${slug}` },
        { status: 400 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const startDate = sp.get("start_date") ?? undefined;
    const endDate = sp.get("end_date") ?? undefined;
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

    const rows = await readStyleCohortPortfolioSeries(pathComponent, {
      startDate,
      endDate,
    });
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "No cohort portfolio history available for this cell",
          equity_style_9box: cellName,
          slug,
        },
        { status: 404 },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": rows[rows.length - 1]!.teo });

    return NextResponse.json(
      {
        equity_style_9box: cellName,
        slug,
        n_periods: rows.length,
        start_teo: rows[0]!.teo,
        end_teo: rows[rows.length - 1]!.teo,
        rows,
      },
      { headers },
    );
  },
  { capabilityId: "style-cohort-portfolio-history" },
);
