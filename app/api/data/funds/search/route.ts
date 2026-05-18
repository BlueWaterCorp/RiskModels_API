import { NextResponse, type NextRequest } from "next/server";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { searchFunds } from "@/lib/dal/funds-engine";
import { isValidStyleSlug, styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/funds/search
 *
 * Query params:
 *   q                 — full-text on ticker / fund_name (ilike)
 *   equity_style_9box — slug (e.g. "large-blend") OR canonical name
 *   primary           — "true" filters to share-class primaries only (Q5)
 *   limit             — max rows (default 50, capped 500)
 *
 * Returns: { results: FundRow[] }
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() ?? undefined;
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 500);
  const primary = searchParams.get("primary") === "true";

  const styleParam = searchParams.get("equity_style_9box")?.trim();
  let equityStyle9Box: string | null | undefined = undefined;
  if (styleParam) {
    if (isValidStyleSlug(styleParam)) {
      equityStyle9Box = styleSlugToName(styleParam);
    } else {
      // Accept the canonical DB form too ("Large Blend"), useful for SDK callers
      equityStyle9Box = styleParam;
    }
  }

  const results = await searchFunds({
    q,
    equityStyle9Box,
    primaryOnly: primary,
    limit,
  });

  return NextResponse.json({ results });
}
