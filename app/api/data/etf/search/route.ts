import { NextResponse, type NextRequest } from "next/server";
import { etfCatalogMetadata, searchEtfs, type EtfSearchHit } from "@/lib/dal/etf-catalog";
import { getEtfUniverse, type EtfUniverse } from "@/lib/dal/etf-universe";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/search?q=<query>&limit=<n>
 *
 * Free discovery endpoint for ETFs. Substring + prefix search over the ETF
 * universe: the holdings catalog at `mcp/data/etf_master.json` (mirror of
 * `Funds_DAG/configs/etf_universe.yaml`) plus the priced and cascade funds
 * from /api/data/etf/universe. Each hit carries `capabilities`
 * { cascade, priced, priced_from, holdings, holdings_as_of, factor_role } so
 * callers can see what the API can do with the fund before chaining into the
 * metrics / holdings / portfolio / returns endpoints by ticker.
 *
 * Symmetric to `/api/data/funds/search` and `/api/13f/filers/search`:
 *   - public read (soft gateway auth)
 *   - empty `q` returns the full universe (capped at `limit`)
 *   - `limit` clamped to [1, 100]; default 25
 *
 * Ranking (higher = better):
 *   100  exact ticker match
 *    70  ticker prefix
 *    50  ticker substring
 *    40  name word-boundary prefix
 *    30  name substring
 *
 * MASTER_BACKLOG L.6 / D.9; RMAPI-14.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = url.searchParams.get("limit");
  let limit = 25;
  if (limitRaw != null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(parsed)) limit = parsed;
  }
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const universe = await getEtfUniverse().catch(() => null);
  const hits = searchUniverse(q, safeLimit, universe);
  const meta = etfCatalogMetadata();
  return NextResponse.json({
    query: q,
    n_results: hits.length,
    n_universe: universe?.counts.total ?? meta.n_entries,
    schema_version: meta.schema_version,
    results: hits,
  });
}

const NO_CAPS = {
  cascade: false,
  priced: false,
  priced_from: null,
  holdings: false,
  holdings_as_of: null,
  factor_role: "none" as const,
};

function searchUniverse(q: string, limit: number, universe: EtfUniverse | null) {
  // Catalog hits keep their existing shape and ranking; universe-only funds
  // (priced / cascade without holdings) are ranked with the same rules.
  const catalogHits: EtfSearchHit[] = searchEtfs(q, 100);
  const byTicker = new Map(universe?.rows.map((r) => [r.ticker, r]) ?? []);
  const seen = new Set(catalogHits.map((h) => h.ticker.toUpperCase()));

  const extra: EtfSearchHit[] = [];
  const query = q.trim().toLowerCase();
  for (const r of universe?.rows ?? []) {
    if (seen.has(r.ticker)) continue;
    const ticker = r.ticker.toLowerCase();
    const name = (r.name ?? "").toLowerCase();
    let score = 0;
    if (!query) score = 0;
    else if (ticker === query) score = 100;
    else if (ticker.startsWith(query)) score = 70;
    else if (ticker.includes(query)) score = 50;
    else if (name && name.split(/[\s&-]+/).some((w) => w === query || w.startsWith(query))) score = 40;
    else if (name.includes(query)) score = 30;
    if (query && score === 0) continue;
    extra.push({ bw_etf_id: r.identifiers.bw_etf_id ?? "", ticker: r.ticker, name: r.name ?? "", score });
  }

  const all = [...catalogHits, ...extra].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.ticker.localeCompare(b.ticker),
  );
  return all.slice(0, limit).map((h) => {
    const row = byTicker.get(h.ticker.toUpperCase());
    return {
      ...h,
      bw_etf_id: h.bw_etf_id || null,
      name: h.name || null,
      capabilities: row?.capabilities ?? { ...NO_CAPS, holdings: !!h.bw_etf_id },
    };
  });
}
