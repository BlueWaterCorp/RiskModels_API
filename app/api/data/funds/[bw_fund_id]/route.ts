import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { resolveFundById } from "@/lib/dal/funds-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/funds/:bw_fund_id
 *
 * Returns the registry row joined with the latest knowledge-mode snapshot
 * from `funds_latest`. Bitemporal lineage surfaces as response headers:
 *   X-Data-As-Of:        funds_latest.report_date
 *   X-Data-Filing-Date:  funds_latest.filing_date
 *
 * v1 has no `?as_of=` query — returns "what we know today" only.
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

  const result = await resolveFundById(bw_fund_id);
  if (!result) {
    return NextResponse.json({ error: "Fund not found" }, { status: 404 });
  }

  const headers = new Headers();
  if (result.latest) {
    headers.set("X-Data-As-Of", result.latest.report_date);
    headers.set("X-Data-Filing-Date", result.latest.filing_date);
    if (result.latest.model_version) {
      headers.set("X-Risk-Model-Version", result.latest.model_version);
    }
  }

  return NextResponse.json(
    { fund: result.fund, latest: result.latest },
    { headers },
  );
}
