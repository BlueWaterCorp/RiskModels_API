import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { searchFilers } from "@/lib/dal/filers-engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/13f/filers/search
 *
 * 13F filer discovery surface. Mirrors /api/funds/search. Free to call
 * (skipBilling); per-filer follow-up calls under /api/13f/filers/{id}/* are
 * metered.
 *
 * Query params:
 *   q              — full-text on name / cik / lei (ilike)
 *   filer_type     — exact match (e.g. 'hedge_fund', 'investment_adviser')
 *   aum_tier       — exact match
 *   modelable_only — "true" filters to filers whose in-ERM3 sub-portfolio passes the modelability gate
 *   limit          — max rows (default 50, capped 500)
 *
 * Returns: { results: FilerRow[] }
 */
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.trim() ?? undefined;
    const filerType = searchParams.get("filer_type")?.trim() ?? undefined;
    const aumTier = searchParams.get("aum_tier")?.trim() ?? undefined;
    const modelableOnly = searchParams.get("modelable_only") === "true";
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 50), 1),
      500,
    );

    const results = await searchFilers({
      q,
      filerType,
      aumTier,
      modelableOnly,
      limit,
    });

    return NextResponse.json({ results });
  },
  { capabilityId: "filer-search", skipBilling: true },
);
