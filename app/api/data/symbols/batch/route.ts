import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTickerAliases } from "@/lib/ticker-aliases";
import { filterSafeMetadata } from "@/lib/dal/symbol-metadata";
import { isDeadSymbolRow, pickLiveRow, resolveSymbolsByTickers } from "@/lib/dal/risk-engine-v3";
import { resolveSymIdsToTickers } from "@/lib/dal/symbols-batch";

export const dynamic = "force-dynamic";

/**
 * POST /api/data/symbols/batch
 *
 * Resolve multiple tickers to symbol registry rows in one call.
 * Body: { tickers: ["AAPL", "MSFT", ...] }
 * Returns: { results: { [ticker]: SymbolRegistryRow } }
 *
 * Reverse mode, for ids returned by the holdings endpoints:
 * Body: { symbols: ["BW-BBG000B9XRY4", "BW-TICKER-XYZ", ...] }
 * Returns: { results: { [bw_sym_id]: { ticker, name } }, unresolved: [...] }
 */
export async function POST(request: NextRequest) {
  let body: { tickers?: string[]; symbols?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Reverse mode: bw_sym_ids from a holdings response → tickers.
  if (body.symbols !== undefined && body.tickers === undefined) {
    const symbols = body.symbols;
    if (
      !Array.isArray(symbols) ||
      symbols.length === 0 ||
      !symbols.every((s): s is string => typeof s === "string" && s.length > 0)
    ) {
      return NextResponse.json(
        { error: "symbols must be a non-empty array of bw_sym_id strings" },
        { status: 400 },
      );
    }
    if (symbols.length > 1000) {
      return NextResponse.json(
        { error: "Max 1000 symbols per request" },
        { status: 400 },
      );
    }
    const resolved = await resolveSymIdsToTickers(symbols);
    const results: Record<string, { ticker: string; name: string | null }> = {};
    for (const [id, label] of resolved) {
      if (label.ticker) results[id] = { ticker: label.ticker, name: label.name };
    }
    const unresolved = Array.from(new Set(symbols)).filter((s) => !(s in results));
    return NextResponse.json({ results, unresolved });
  }

  const tickers = body.tickers;
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json(
      { error: "tickers or symbols array is required" },
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
  // Registry tickers whose only rows are dead: the DAL resolver decides them
  // below, so this route and /ticker-returns name the same security.
  const deadTickers = new Set<string>();
  for (const rows of grouped.values()) {
    const row = pickLiveRow(rows as unknown as Record<string, unknown>[]) as unknown as SymbolRow | null;
    if (!row) continue;
    if (isDeadSymbolRow(row as unknown as Record<string, unknown>)) deadTickers.add(row.ticker);
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

  // Tickers no live registry row carries (delisted holders such as CTRA, or
  // dead-only rows): answer from the shared DAL resolver's most-recent-holder
  // pass, keyed by the requested ticker and disclosed via `resolved_via` /
  // `delisted`. A dead row the resolver keeps gains the flags; one it
  // replaces with a live holder is swapped out.
  const missing = Array.from(
    new Set(
      tickers
        .map((t, i) => ({ requested: String(t).toUpperCase(), canonical: canonicalTickers[i] }))
        .filter(
          ({ requested, canonical }) =>
            !canonical ||
            !(canonical in results) ||
            (canonical === requested && deadTickers.has(canonical)),
        )
        .map(({ requested }) => requested),
    ),
  );
  if (missing.length > 0) {
    const holders = await resolveSymbolsByTickers(missing);
    for (const t of missing) {
      const h = holders.get(t);
      if (!h) continue;
      const existing = results[t] as { symbol?: string } | undefined;
      const flags = h.resolved_via
        ? { resolved_via: h.resolved_via, delisted: h.delisted ?? false }
        : {};
      if (existing && existing.symbol === h.symbol) {
        results[t] = { ...existing, ...flags };
        continue;
      }
      if (existing && !deadTickers.has(t)) continue;
      results[t] = {
        symbol: h.symbol,
        ticker: h.ticker,
        name: h.name,
        asset_type: h.asset_type,
        sector_etf: h.sector_etf,
        subsector_etf: h.subsector_etf,
        is_adr: h.is_adr,
        metadata: {},
        latest_metrics: null,
        latest_vol: null,
        latest_teo: null,
        ...flags,
      };
    }
  }

  return NextResponse.json({ results });
}
