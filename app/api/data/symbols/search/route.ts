import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/symbols/search?q=AAPL&limit=50
 *
 * Search symbols table by ticker or company name (ilike).
 * Also supports ?asset_type=stock to filter by asset type.
 */
export async function GET(request: NextRequest) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 500);
  const assetType = searchParams.get("asset_type");

  const supabase = createAdminClient();

  const sectorEtf = searchParams.get("sector_etf");
  const orderBy = searchParams.get("order_by"); // e.g. "latest_vol"

  let query = supabase
    .from("symbols")
    .select("symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, isin, metadata, latest_metrics, latest_vol, latest_teo");

  if (q) {
    query = query.or(`ticker.ilike.%${q}%,name.ilike.%${q}%`);
  }

  if (assetType) {
    query = query.eq("asset_type", assetType);
  }

  if (sectorEtf) {
    query = query.eq("sector_etf", sectorEtf.toUpperCase());
  }

  if (orderBy === "latest_vol") {
    query = query.order("latest_vol", { ascending: false, nullsFirst: false });
  }

  query = query.limit(limit);

  const { data, error } = await query;

  if (error) {
    console.error("[data/symbols/search] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}
