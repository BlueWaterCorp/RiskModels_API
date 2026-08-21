/**
 * Peer L3 bar for the single-name snapshot PDF.
 *
 * Same construction as riskmodels.net /stocks: equal-weighted mean of the four
 * ER shares. Prefer the name's subsector ETF; if that cohort is too thin to
 * report, fall back to the sector ETF and say so in the label. Do not silently
 * keep the subsector name on a sector mix.
 *
 * The stacked bar is equal-weighted. `membersLine` lists the ten largest
 * names by market cap so the reader can see who is in the cohort; that ranking
 * is not the bar's weights.
 */

import type { PeerVarianceBar } from "@/lib/portfolio/risk-snapshot-pdf";
import {
  getCohortVarianceShares,
  ThinCohortError,
  type CohortLevel,
} from "@/lib/risk/cohort-variance-shares-service";

export const LARGEST_PEER_N = 10;

export function peerCohortAttempts(
  row: Record<string, unknown>,
): { cohort: string; level: CohortLevel }[] {
  const sub =
    typeof row.subsector_etf === "string" ? row.subsector_etf.trim().toUpperCase() : "";
  const sec =
    typeof row.sector_etf === "string" ? row.sector_etf.trim().toUpperCase() : "";
  const out: { cohort: string; level: CohortLevel }[] = [];
  if (sub) out.push({ cohort: sub, level: "subsector" });
  if (sec) out.push({ cohort: sec, level: "sector" });
  return out;
}

/** "MSFT · ORCL · NOW · ..." — ten largest, ellipsis when the cohort is bigger. */
export function formatLargestPeerTickers(
  tickers: string[],
  nNames: number,
): string {
  const shown = tickers.slice(0, LARGEST_PEER_N);
  if (shown.length === 0) return "";
  const body = shown.join(" · ");
  return nNames > shown.length ? `${body} · ...` : body;
}

export async function loadPeerVarianceBar(
  ticker: string,
  row: Record<string, unknown>,
): Promise<PeerVarianceBar | null> {
  const attempts = peerCohortAttempts(row);
  const exclude = typeof row.symbol === "string" ? row.symbol : null;
  for (const { cohort, level } of attempts) {
    try {
      const shares = await getCohortVarianceShares({
        cohort,
        level,
        excludeSymbol: exclude,
      });
      const m = shares.equal_weighted_mean;
      return {
        label: `${shares.cohort} ${shares.level} peers · ${shares.n_names} names · equal-weighted`,
        membersLine: formatLargestPeerTickers(
          shares.largest_tickers,
          shares.n_names,
        ),
        market: m.market_er_pct / 100,
        sector: m.sector_er_pct / 100,
        subsector: m.subsector_er_pct / 100,
        residual: m.residual_er_pct / 100,
      };
    } catch (err) {
      if (err instanceof ThinCohortError) continue;
      console.error(`[snapshot.pdf] peer bar for ${ticker} ${cohort}/${level} failed:`, err);
      return null;
    }
  }
  return null;
}
