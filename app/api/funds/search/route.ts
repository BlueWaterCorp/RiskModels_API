import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { searchFunds } from "@/lib/dal/funds-engine";
import { isValidStyleSlug, styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/search
 *
 * Public funds discovery surface. Mirrors the internal /api/data/funds/search
 * route but uses user-key auth via withBilling, so an `rm_agent_live_*` token
 * resolves a `bw_fund_id` for downstream `/api/funds/{bw_fund_id}/*` calls.
 *
 * Search itself is free (skipBilling). Per-fund follow-up calls are metered.
 *
 * Query params:
 *   q                 — full-text on ticker / fund_name (ilike)
 *   equity_style_9box — style slug ("large-blend") OR canonical name ("Large Blend")
 *   primary           — "true" filters to share-class primaries only
 *   limit             — max rows (default 50, capped 500)
 *
 * Returns: { results: FundRow[] }
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.trim() ?? undefined;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 50), 1),
      500,
    );
    const primary = searchParams.get("primary") === "true";

    const styleParam = searchParams.get("equity_style_9box")?.trim();
    let equityStyle9Box: string | null | undefined = undefined;
    if (styleParam) {
      if (isValidStyleSlug(styleParam)) {
        equityStyle9Box = styleSlugToName(styleParam);
      } else {
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
  },
  { capabilityId: "fund-search", skipBilling: true },
);
