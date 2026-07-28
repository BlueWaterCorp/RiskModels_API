import { NextResponse, type NextRequest } from "next/server";
import { etfCatalogMetadata, searchEtfs } from "@/lib/dal/etf-catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/etf/search?q=<query>&limit=<n>
 *
 * Free discovery endpoint for ETFs. Substring + prefix search over the
 * committed cross-repo catalog at `mcp/data/etf_master.json` (mirror of
 * `Funds_DAG/configs/etf_universe.yaml`). Returns the same row shape as
 * `/api/data/etf/{ticker}` minus per-zarr aggregates, so callers can chain
 * search hits into the metrics / holdings / portfolio endpoints by ticker.
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
 *    20  sponsor exact / substring
 *
 * MASTER_BACKLOG L.6 / D.9.
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

  const hits = searchEtfs(q, limit);
  const meta = etfCatalogMetadata();
  return NextResponse.json({
    query: q,
    n_results: hits.length,
    n_universe: meta.n_entries,
    schema_version: meta.schema_version,
    results: hits,
  });
}
