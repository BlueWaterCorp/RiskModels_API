import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { loadCohortSnapshot } from "@/lib/funds/cohort-snapshot-loader";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/style/{slug}/snapshot
 *
 * The "differentiated wedge" — composed cohort snapshot for one of the 9-box
 * style cells. Assembles cohort metrics (EW + MV) + top-25 cohort holdings
 * (MV) + 12-month cohort portfolio history (EW + MV) + top-10 funds in cell
 * + top-15 symbols in cell. Morningstar reports per-fund metrics but doesn't
 * render this cohort-aggregate surface.
 *
 * Public-facing analytical surface; the matching `.pdf` endpoint (Stage
 * D.2.d) renders this same composition through the C1 print template.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    // Path: /api/funds/style/{slug}/snapshot — slug is the second-to-last segment.
    const slug = segments[segments.length - 2] ?? "";

    const result = await loadCohortSnapshot(slug);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, slug },
        { status: result.status },
      );
    }

    const headers = new Headers({ "X-Data-As-Of": result.reportDate });
    if (result.filingDate) {
      headers.set("X-Data-Filing-Date", result.filingDate);
    }
    if (result.modelVersion) {
      headers.set("X-Risk-Model-Version", result.modelVersion);
    }

    return NextResponse.json(result.snapshot, { headers });
  },
  { capabilityId: "style-cohort-snapshot-json" },
);
