import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { fetchFundLatest } from "@/lib/dal/funds-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/funds-latest/:bw_fund_id
 *
 * Returns just the wide-row snapshot from `funds_latest` (skips the registry
 * join). Useful for SDK consumers that already have the registry row or only
 * need the metric columns.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bw_fund_id: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { bw_fund_id } = await params;
  if (!bw_fund_id) {
    return NextResponse.json(
      { error: "bw_fund_id is required" },
      { status: 400 },
    );
  }

  const latest = await fetchFundLatest(bw_fund_id);
  if (!latest) {
    return NextResponse.json(
      { error: "Fund latest row not found" },
      { status: 404 },
    );
  }

  const headers = new Headers({
    "X-Data-As-Of": latest.report_date,
    "X-Data-Filing-Date": latest.filing_date,
  });
  if (latest.model_version) {
    headers.set("X-Risk-Model-Version", latest.model_version);
  }

  return NextResponse.json(latest, { headers });
}
