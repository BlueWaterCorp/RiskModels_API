import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/landing-cache?limit=10000
 *
 * Fetch raw daily returns from erm3_landing_chart_cache.
 * Pipeline-maintained table; caller accumulates returns for any start date.
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 10000), 50000);

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("erm3_landing_chart_cache")
    .select(
      "ticker, date, ret_stock, ret_market, ret_sector, ret_subsector, sector_etf, subsector_etf",
    )
    .limit(limit);

  if (error) {
    console.error("[data/landing-cache] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
