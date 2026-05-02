import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { resolveFundById } from "@/lib/dal/funds-engine";
import { formatFundMetrics } from "@/lib/funds/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/{bw_fund_id}
 *
 * Latest knowledge-mode metrics for a single mutual fund. Reads from
 * `public.funds` and `public.funds_latest`. Pure Supabase; the per-fund
 * time series, holdings panel, and hedge ratios live in GCS Zarr and
 * surface via /portfolio, /holdings, /hedge in Stage B.2.
 *
 * Bitemporal lineage on response headers: X-Data-As-Of (= report_date),
 * X-Data-Filing-Date (= filing_date), X-Risk-Model-Version. v1 returns the
 * latest knowledge-mode row only; ?as_of= is deferred to v2.
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const bwFundId = request.nextUrl.pathname.split("/").pop();
    if (!bwFundId) {
      return NextResponse.json(
        { error: "bw_fund_id is required" },
        { status: 400 },
      );
    }

    const result = await resolveFundById(bwFundId);
    if (!result) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    if (!result.latest) {
      return NextResponse.json(
        {
          error: "No funds_latest row for this fund",
          bw_fund_id: result.fund.bw_fund_id,
        },
        { status: 404 },
      );
    }

    const body = formatFundMetrics(result.fund, result.latest);
    const headers = new Headers({
      "X-Data-As-Of": result.latest.report_date,
      "X-Data-Filing-Date": result.latest.filing_date,
    });
    if (result.latest.model_version) {
      headers.set("X-Risk-Model-Version", result.latest.model_version);
    }

    return NextResponse.json(body, { headers });
  },
  { capabilityId: "fund-metrics" },
);
