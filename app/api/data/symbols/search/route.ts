import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTicker } from "@/lib/ticker-aliases";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/symbols/search?q=AAPL&limit=50
 *
 * Search symbols table by ticker or company name (ilike).
 * Also supports ?asset_type=stock to filter by asset type.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 500);
  const assetType = searchParams.get("asset_type");

  const supabase = createAdminClient();

  const sectorEtf = searchParams.get("sector_etf");
  const orderBy = searchParams.get("order_by"); // e.g. "latest_vol"

  let query = supabase
    .from("symbols")
    .select(
      "symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, metadata, latest_metrics, latest_vol, latest_teo",
    );

  if (q) {
    // A dual-class query resolves to the class the registry actually carries
    // (GOOGL → GOOG, BRK-A → BRK-B), so the search returns a hit rather than
    // nothing. Match names against the original query either way.
    const resolution = await resolveTicker(q);
    const tickerMatch =
      resolution.canonical !== resolution.requested ? resolution.canonical : q;
    query = query.or(`ticker.ilike.%${tickerMatch}%,name.ilike.%${q}%`);
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

  // Same normalization as /symbols/{ticker} and /symbols/batch: the raw
  // metadata JSONB carries licensed identifiers, so it never ships whole.
  const results = (data ?? []).map((row) => {
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    return {
      symbol: row.symbol,
      ticker: row.ticker,
      name: row.name ?? (metadata.company_name as string | null) ?? null,
      asset_type: row.asset_type,
      sector_etf: row.sector_etf ?? (metadata.sector_etf as string | null) ?? null,
      subsector_etf: row.subsector_etf,
      is_adr: row.is_adr,
      metadata: filterSafeMetadata(row.metadata),
      latest_metrics: row.latest_metrics,
      latest_vol: row.latest_vol,
      latest_teo: row.latest_teo,
    };
  });

  return NextResponse.json({ results });
}
