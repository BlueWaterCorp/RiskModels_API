/**
 * Portfolio helpers for the OpenBB adapter.
 *
 * /api/portfolio/risk-snapshot is POST (takes a positions array), but OpenBB
 * widgets fetch via GET — so the widget takes a `positions` text param
 * ("AAPL:0.4, MSFT:0.35, NVDA:0.25") which we parse and POST upstream.
 */
import { portalBase, upstreamBase } from "./upstream";

export type Position = { ticker: string; weight: number };

/** Parse "AAPL:0.4, MSFT:0.35, NVDA:0.25" (or bare "AAPL,MSFT,NVDA" = equal weight). */
export function parsePositions(raw: string | null): Position[] {
  if (!raw) return [];
  const out: Position[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [t, w] = part.split(/[:=]/).map((s) => s.trim());
    if (!t) continue;
    const weight = w ? Number(w) : 1;
    out.push({
      ticker: t.toUpperCase(),
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    });
  }
  return out;
}

export type SyncedPositions = {
  positions: Position[];
  /** Real holdings dropped because /portfolio/risk-snapshot requires a positive weight (e.g. shorts) — surfaced, never silently discarded. */
  excluded: Array<{ ticker: string; weight: number }>;
};

/**
 * Key->portfolio bridge (E.23 B.6): resolve the OpenBB user's real,
 * ConnectTrade/Plaid-synced positions from the portal (riskmodels.net),
 * using the same key the user supplied for the RiskModels API — the two
 * share one Supabase project and API-key table, so the key resolves to the
 * same user on both sides. Returns null on any failure (no positions synced,
 * auth mismatch, portal unreachable) so callers can show a clear message
 * instead of guessing.
 *
 * `/portfolio/risk-snapshot` requires `weight > 0` (`PortfolioRiskSnapshotRequestSchema`
 * in RiskModels_API's own `lib/api/schemas.ts`), so short positions (negative
 * weight) can't be passed through as-is — they're reported in `excluded`
 * rather than dropped without a trace.
 */
export async function fetchSyncedPositions(key: string): Promise<SyncedPositions | null> {
  let res: Response;
  try {
    res = await fetch(`${portalBase()}/api/positions`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as {
    positions?: Array<{ ticker: string; weight: number | null }>;
  } | null;
  const rows = body?.positions ?? [];

  const positions: Position[] = [];
  const excluded: Array<{ ticker: string; weight: number }> = [];
  for (const p of rows) {
    if (typeof p.weight !== "number") continue; // no market value to weight by — drop silently, nothing to report
    if (p.weight > 0) {
      positions.push({ ticker: p.ticker.toUpperCase(), weight: p.weight });
    } else {
      excluded.push({ ticker: p.ticker.toUpperCase(), weight: p.weight });
    }
  }

  return positions.length || excluded.length ? { positions, excluded } : null;
}

/** POST the parsed positions to the real portfolio risk-snapshot endpoint. */
export async function fetchPortfolioSnapshot(
  positions: Position[],
  key: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${upstreamBase()}/portfolio/risk-snapshot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ positions, include_hedge_ratios: true }),
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = { error: "upstream returned non-JSON", status: res.status };
  }
  return { status: res.status, body };
}
