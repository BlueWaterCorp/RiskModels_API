import { NextResponse, type NextRequest } from "next/server";
import {
  getEtfUniverse,
  matchesCapabilityFilter,
  parseCapabilityFilter,
  ETF_REASON_CODES,
} from "@/lib/dal/etf-universe";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/universe[?cascade=true&priced=true&holdings=false&factor_role=sector]
 *
 * Free public read (data-gateway per-IP rate limit, like the other
 * /api/data/etf routes). Every ETF the API knows, with three capabilities:
 *
 *   cascade   SPY, sector and subsector ETFs the ERM3 cascade hedges with
 *   priced    daily returns in the ETF return store (returns, covariance, beta to SPY)
 *   holdings  look-through holdings (holdings, benchmark fit)
 *
 * plus factor_role and identifiers (FIGI / CIK / BW ids only). Built from the
 * holdings catalog, the ETF return store's symbol list, the weekly hedge
 * snapshot's cascade ETFs and (when committed) the ERM3 register mirror;
 * cached in-process for an hour. `holdings_as_of` is null here — read it from
 * /api/data/etf/{ticker}. RMAPI-14; docs/ETF_COVERAGE.md.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const filter = parseCapabilityFilter(url.searchParams);
  const u = await getEtfUniverse();
  const results = u.rows.filter((r) => matchesCapabilityFilter(r, filter));
  return NextResponse.json(
    {
      n_results: results.length,
      counts: u.counts,
      filters: filter,
      sources: u.sources,
      reason_codes: Object.values(ETF_REASON_CODES),
      built_at: u.built_at,
      results,
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
  );
}
