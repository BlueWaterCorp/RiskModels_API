import { NextResponse, type NextRequest } from "next/server";
import { withBilling, type BillingContext } from "@/lib/agent/billing-middleware";
import { searchFunds } from "@/lib/dal/funds-engine";
import { isValidStyleSlug, styleSlugToName } from "@/lib/funds/style-slug";

export const dynamic = "force-dynamic";

/**
 * GET /api/funds/search
 *
 * Public funds discovery surface — resolves a `bw_fund_id` for downstream
 * `/api/funds/{bw_fund_id}/*` calls, which ARE metered.
 *
 * AUTH: none. `skipBilling: true` returns before key validation in
 * withBilling (see lib/agent/billing-middleware.ts), so this endpoint is
 * genuinely public — it is not "authenticated but free". Do not add fields
 * here that should sit behind a key.
 *
 * Because it is public and bulk-readable over licensed fund reference data
 * (EODHD expense ratios via Funds_DAG), it carries a per-IP throttle and a
 * tighter row cap than the internal /api/data/funds/search mirror.
 *
 * Query params:
 *   q                 — full-text on ticker / fund_name (ilike)
 *   equity_style_9box — style slug ("large-blend") OR canonical name ("Large Blend")
 *   primary           — "true" filters to share-class primaries only
 *   limit             — max rows (default 50, capped 100)
 *
 * Returns: { results: FundRow[] }
 */
const fundSearchRpm = Number.parseInt(process.env.FUND_SEARCH_IP_RPM ?? "60", 10);
const effectiveFundSearchRpm =
  Number.isFinite(fundSearchRpm) && fundSearchRpm > 0 ? fundSearchRpm : 60;

/** Public bulk-read cap. The keyed /api/data mirror still allows 500. */
const MAX_PUBLIC_LIMIT = 100;
export const GET = withBilling(
  async (request: NextRequest, _context: BillingContext) => {
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.trim() ?? undefined;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 50), 1),
      MAX_PUBLIC_LIMIT,
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
  {
    capabilityId: "fund-search",
    skipBilling: true,
    publicIpRateLimitPerMinute: effectiveFundSearchRpm,
  },
);
