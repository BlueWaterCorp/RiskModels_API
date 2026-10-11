import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTicker } from "@/lib/ticker-aliases";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";
import {
  isDeadSymbolRow,
  pickLiveRow,
  resolveSymbolByTicker,
} from "@/lib/dal/risk-engine-v3";
import { resolutionDisclosure } from "@/lib/dal/resolution-disclosure";

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

  // Every row for the ticker (recycled tickers keep their dead holders), then
  // the DAL's pick — live first, then lowest bw_sym_id. maybeSingle() 500'd
  // on the second row.
  const { data: rows, error } = await supabase
    .from("symbols")
    .select(
      "symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, metadata, latest_metrics, latest_vol, latest_teo",
    )
    .eq("ticker", canonicalTicker)
    .order("symbol", { ascending: true });

  if (error) {
    console.error(`[data/symbols] Error resolving ${canonicalTicker}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  type SymbolRow = NonNullable<typeof rows>[number];
  const data = pickLiveRow((rows ?? []) as unknown as Record<string, unknown>[]) as unknown as
    | SymbolRow
    | null;

  // No live registry row carries the ticker: defer to the shared DAL
  // resolver so this route and /ticker-returns name the same security: the
  // ticker's live holder outside the registry, the dead row or alias row it
  // answered before, or its most recent former holder (delisted CTRA).
  // Disclosure fields (resolved_via / delisted / ticker_reassigned) come
  // from the DAL via resolutionDisclosure.
  // Same predicate as the batch route: only a dead row under the requested
  // ticker itself (no notation rewrite, no share-class projection) defers.
  const deadRow =
    data &&
    isDeadSymbolRow(data as Record<string, unknown>) &&
    resolution.canonical === resolution.requested.trim().toUpperCase();
  let holder: Awaited<ReturnType<typeof resolveSymbolByTicker>> = null;
  if (!data || deadRow) {
    holder = await resolveSymbolByTicker(ticker, { disclosing: true });
    // DAL found nothing: 404 only when there is no registry row either; a
    // loaded dead row stays (same as the batch route).
    if (!holder && !data) {
      return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
    }
  }
  // DAL returned nothing for a dead registry row (its checks could not run):
  // serve the row as main did, marked delisted and unchecked.
  const holderFlags =
    !holder && deadRow ? { delisted: true, resolution_degraded: true } : resolutionDisclosure(holder);

  if (holder && (!data || holder.symbol !== data.symbol)) {
    // The answering id's own registry row (if any) supplies metadata and the
    // latest metrics, so a relabelled registry holder is not served blank.
    const { data: own } = await supabase
      .from("symbols")
      .select("symbol, metadata, latest_metrics, latest_vol, latest_teo")
      .eq("symbol", holder.symbol)
      .maybeSingle();
    const ownRow = own as {
      metadata?: unknown;
      latest_metrics?: unknown;
      latest_vol?: unknown;
      latest_teo?: unknown;
    } | null;
    return NextResponse.json({
      symbol: holder.symbol,
      ticker: holder.ticker,
      requested_ticker: resolution.requested,
      is_modelled_class: holder.is_modelled_class,
      modelled_ticker: holder.modelled_ticker,
      share_class: holder.share_class,
      modelled_share_class: holder.modelled_share_class,
      name: holder.name,
      asset_type: holder.asset_type,
      sector_etf: holder.sector_etf,
      subsector_etf: holder.subsector_etf,
      is_adr: holder.is_adr,
      metadata: ownRow ? filterSafeMetadata(ownRow.metadata) : {},
      latest_metrics: ownRow?.latest_metrics ?? null,
      latest_vol: ownRow?.latest_vol ?? null,
      latest_teo: ownRow?.latest_teo ?? null,
      ...holderFlags,
    });
  }
  if (!data) {
    return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
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
    ...holderFlags,
  };

  return NextResponse.json(normalized);
}
