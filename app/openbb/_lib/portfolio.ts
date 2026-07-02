/**
 * Portfolio helpers for the OpenBB adapter.
 *
 * /api/portfolio/risk-snapshot is POST (takes a positions array), but OpenBB
 * widgets fetch via GET — so the widget takes a `positions` text param
 * ("AAPL:0.4, MSFT:0.35, NVDA:0.25") which we parse and POST upstream.
 */
import { upstreamBase } from "./upstream";

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
