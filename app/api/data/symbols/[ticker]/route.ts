import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTicker } from "@/lib/ticker-aliases";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";
import { resolveSymbolByTicker } from "@/lib/dal/risk-engine-v3";

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
  const { ticker } = await params;
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Resolve notation (BRK.B → BRK-B) and share-class projection (GOOGL → GOOG)
  // separately, so the response can report the second and stay quiet about the
  // first.
  const resolution = await resolveTicker(ticker);
  const canonicalTicker = resolution.canonical;

  const { data, error } = await supabase
    .from("symbols")
    .select(
      "symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, metadata, latest_metrics, latest_vol, latest_teo",
    )
    .eq("ticker", canonicalTicker)
    .maybeSingle();

  if (error) {
    console.error(`[data/symbols] Error resolving ${canonicalTicker}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!data) {
    // No registry row carries the ticker today: fall back to the shared DAL
    // resolver, which answers with the most recent holder (delisted names
    // such as CTRA) and discloses that via `resolved_via` / `delisted`.
    const holder = await resolveSymbolByTicker(ticker);
    if (!holder?.resolved_via) {
      return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
    }
    return NextResponse.json({
      symbol: holder.symbol,
      ticker: holder.ticker,
      requested_ticker: resolution.requested,
      is_modelled_class: true,
      modelled_ticker: null,
      share_class: null,
      modelled_share_class: null,
      name: holder.name,
      asset_type: holder.asset_type,
      sector_etf: holder.sector_etf,
      subsector_etf: holder.subsector_etf,
      is_adr: holder.is_adr,
      metadata: {},
      latest_metrics: null,
      latest_vol: null,
      latest_teo: null,
      resolved_via: holder.resolved_via,
      delisted: holder.delisted ?? false,
    });
  }

  // Normalize: fall back to metadata JSONB for name/sector_etf
  const metadata = (data.metadata as Record<string, unknown>) ?? {};
  const normalized = {
    symbol: data.symbol,
    // The registry row's own ticker. When a projection applied this is the
    // sibling class (GOOG for a GOOGL request) — the row genuinely is GOOG's,
    // and `requested_ticker` below records what was asked for.
    ticker: data.ticker,
    requested_ticker: resolution.requested,
    /** False when these numbers belong to a different share class. */
    is_modelled_class: !resolution.projected,
    modelled_ticker: resolution.projected ? resolution.canonical : null,
    share_class: resolution.requestedClass,
    modelled_share_class: resolution.modelledClass,
    name: data.name ?? (metadata.company_name as string | null) ?? null,
    asset_type: data.asset_type,
    sector_etf:
      data.sector_etf ?? (metadata.sector_etf as string | null) ?? null,
    subsector_etf: data.subsector_etf,
    is_adr: data.is_adr,
    metadata: filterSafeMetadata(data.metadata),
    latest_metrics: data.latest_metrics,
    latest_vol: data.latest_vol,
    latest_teo: data.latest_teo,
  };

  return NextResponse.json(normalized);
}
