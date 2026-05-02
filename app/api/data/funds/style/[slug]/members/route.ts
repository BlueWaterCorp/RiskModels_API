import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { getStyleCellMembers } from "@/lib/dal/funds-engine";
import { styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/funds/style/:slug/members
 *
 * Returns the bw_fund_id list for a 9-box style cell. Used by SDK consumers
 * to materialize a peer cohort before calling /batch for the metric rows.
 *
 * Query params:
 *   primary  — "true" filters to primary share class only (Q5 lock)
 *   limit    — max ids returned (default 5000, capped 20000)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { slug } = await params;
  const cellName = styleSlugToName(slug ?? "");
  if (!cellName) {
    return NextResponse.json(
      { error: `Invalid style slug: ${slug}` },
      { status: 400 },
    );
  }

  const { searchParams } = request.nextUrl;
  const primary = searchParams.get("primary") === "true";
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? 5000), 1),
    20_000,
  );

  const members = await getStyleCellMembers(cellName, {
    primaryOnly: primary,
    limit,
  });

  return NextResponse.json({
    equity_style_9box: cellName,
    slug,
    fund_ids: members,
    count: members.length,
  });
}
