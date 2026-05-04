// licensed-id-ok-file: AUDIT-PENDING — public per-ticker symbol endpoint
// selects and returns `isin` from the symbols table. Pre-existing exposure
// flagged for license-team review; clear by either removing `isin` from
// the response shape (Path 1) or confirming ANNA license covers
// redistribution (Path 2).
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGatewayAuth } from "@/lib/gateway-auth";
import { resolveTickerAlias } from "@/lib/ticker-aliases";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/symbols/:ticker
 *
 * Resolve a single ticker to its full symbol registry row.
 * Returns normalized metadata (falls back to metadata JSONB for name/sector_etf).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const denied = verifyGatewayAuth(request);
  if (denied) return denied;

  const { ticker } = await params;
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Apply ticker alias resolution (e.g., GOOGL → GOOG)
  const canonicalTicker = resolveTickerAlias(ticker);

  const { data, error } = await supabase
    .from("symbols")
    .select(
      "symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, isin, metadata, latest_metrics, latest_vol, latest_teo",
    )
    .eq("ticker", canonicalTicker)
    .maybeSingle();

  if (error) {
    console.error(`[data/symbols] Error resolving ${canonicalTicker}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
  }

  // Normalize: fall back to metadata JSONB for name/sector_etf
  const metadata = (data.metadata as Record<string, unknown>) ?? {};
  const normalized = {
    symbol: data.symbol,
    ticker: data.ticker,
    name: data.name ?? (metadata.company_name as string | null) ?? null,
    asset_type: data.asset_type,
    sector_etf:
      data.sector_etf ?? (metadata.sector_etf as string | null) ?? null,
    subsector_etf: data.subsector_etf,
    is_adr: data.is_adr,
    isin: data.isin,
    metadata: data.metadata,
    latest_metrics: data.latest_metrics,
    latest_vol: data.latest_vol,
    latest_teo: data.latest_teo,
  };

  return NextResponse.json(normalized);
}
