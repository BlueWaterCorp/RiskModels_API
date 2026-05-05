import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { loadFundSnapshot } from "@/lib/funds/snapshot-loader";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/snapshot/{bw_fund_id}
 *
 * Composed JSON snapshot — assembles registry + latest metrics + top-N
 * holdings + L1/L2/L3 hedge + 12-month portfolio time series + cohort
 * context (fund's rank within its 9-box cell on every metric the rankings
 * table covers). All sub-fetches run in parallel.
 *
 * Public-facing analytical surface; the matching `.pdf` endpoint (Stage
 * D.2.b) renders this same composition to a 1-page tearsheet server-side.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const segments = request.nextUrl.pathname.split("/");
    const bwFundId = segments[segments.length - 1];
    if (!bwFundId) {
      return NextResponse.json(
        { error: "bw_fund_id is required" },
        { status: 400 },
      );
    }

    const result = await loadFundSnapshot(bwFundId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, bw_fund_id: bwFundId },
        { status: result.status },
      );
    }

    const headers = new Headers({
      "X-Data-As-Of": result.reportDate,
      "X-Data-Filing-Date": result.filingDate,
    });
    if (result.modelVersion) {
      headers.set("X-Risk-Model-Version", result.modelVersion);
    }

    return NextResponse.json(result.snapshot, { headers });
  },
  { capabilityId: "fund-snapshot-json" },
);
