import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTickerAliases } from "@/lib/ticker-aliases";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";
import { pickLiveRow } from "@/lib/dal/risk-engine-v3";

export const dynamic = "force-dynamic";

/**
 * POST /api/data/symbols/batch
 *
 * Resolve multiple tickers to symbol registry rows in one call.
 * Body: { tickers: ["AAPL", "MSFT", ...] }
 *
 * Returns: { results: { [ticker]: SymbolRegistryRow } }
 */
export async function POST(request: NextRequest) {
  let body: { tickers?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tickers = body.tickers;
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json(
      { error: "tickers array is required" },
      { status: 400 },
    );
  }

  if (tickers.length > 1000) {
    return NextResponse.json(
      { error: "Max 1000 tickers per request" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  // Apply ticker alias resolution (e.g., GOOGL → GOOG)
  const canonicalTickers = await resolveTickerAliases(tickers);

  const { data, error } = await supabase
    .from("symbols")
    .select(
      "symbol, ticker, name, asset_type, sector_etf, subsector_etf, is_adr, metadata, latest_metrics, latest_vol, latest_teo",
    )
    .in("ticker", canonicalTickers);

  if (error) {
    console.error("[data/symbols/batch] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Key by ticker, normalize metadata fallback. Recycled tickers return >1 row
  // per ticker (the sync never prunes closed identities); this used to be
  // last-wins, disagreeing with the DAL. Pick the live identity first, then
  // the lowest bw_sym_id — the same rule as resolveSymbolByTicker.
  type SymbolRow = NonNullable<typeof data>[number];
  const grouped = new Map<string, SymbolRow[]>();
  for (const row of data ?? []) {
    const bucket = grouped.get(row.ticker) ?? [];
    bucket.push(row);
    grouped.set(row.ticker, bucket);
  }
  const results: Record<string, unknown> = {};
  for (const rows of grouped.values()) {
    const row = pickLiveRow(rows as unknown as Record<string, unknown>[]) as unknown as SymbolRow | null;
    if (!row) continue;
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    results[row.ticker] = {
      symbol: row.symbol,
      ticker: row.ticker,
      name: row.name ?? (metadata.company_name as string | null) ?? null,
      asset_type: row.asset_type,
      sector_etf:
        row.sector_etf ?? (metadata.sector_etf as string | null) ?? null,
      subsector_etf: row.subsector_etf,
      is_adr: row.is_adr,
      metadata: filterSafeMetadata(row.metadata),
      latest_metrics: row.latest_metrics,
      latest_vol: row.latest_vol,
      latest_teo: row.latest_teo,
    };
  }

  return NextResponse.json({ results });
}
