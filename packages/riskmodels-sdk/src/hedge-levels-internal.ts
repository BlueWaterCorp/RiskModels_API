/**
 * Portable copy of `@/lib/risk/hedge-levels.ts` aggregates for the published SDK.
 * Keep in sync with server SSOT semantics (ERM3 cascade HR/ER, weighted portfolio means).
 */

export type HedgeLevelId = "L1" | "L2" | "L3";

export interface LevelHedgeSnapshot {
  market_hr: number | null;
  sector_hr: number | null;
  subsector_hr: number | null;
  market_er: number | null;
  sector_er: number | null;
  subsector_er: number | null;
  residual_er: number | null;
  hedge_etfs: { market: string; sector: string | null; subsector: string | null };
}

export interface HedgeLevelsBlock {
  L1: LevelHedgeSnapshot;
  L2: LevelHedgeSnapshot;
  L3: LevelHedgeSnapshot;
}

function weightedMean(parts: Array<{ w: number; v: number | null }>): number | null {
  let numSum = 0;
  let den = 0;
  for (const { w, v } of parts) {
    if (v == null || !Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    numSum += w * v;
    den += w;
  }
  return den > 0 ? numSum / den : null;
}

const SNAPSHOT_SCALAR_KEYS = [
  "market_hr",
  "sector_hr",
  "subsector_hr",
  "market_er",
  "sector_er",
  "subsector_er",
  "residual_er",
] as const;

export function aggregatePortfolioHedgeLevels(
  weightsByTicker: Record<string, number>,
  blocksByTicker: Record<string, HedgeLevelsBlock | undefined | null>,
): HedgeLevelsBlock {
  const LEVELS = ["L1", "L2", "L3"] as const;
  const out: HedgeLevelsBlock = {} as HedgeLevelsBlock;

  for (const lvl of LEVELS) {
    const etfMerged: LevelHedgeSnapshot["hedge_etfs"] = {
      market: "SPY",
      sector: null,
      subsector: null,
    };

    const partsLists: Record<(typeof SNAPSHOT_SCALAR_KEYS)[number], Array<{ w: number; v: number | null }>> =
      {
        market_hr: [],
        sector_hr: [],
        subsector_hr: [],
        market_er: [],
        sector_er: [],
        subsector_er: [],
        residual_er: [],
      };

    for (const ticker of Object.keys(weightsByTicker)) {
      const w = weightsByTicker[ticker];
      const block = blocksByTicker[ticker];
      if (!block || !Number.isFinite(w) || w <= 0) continue;
      const snap = block[lvl];
      for (const k of SNAPSHOT_SCALAR_KEYS) {
        partsLists[k].push({ w, v: snap[k] });
      }
    }

    const row: LevelHedgeSnapshot = {
      market_hr: weightedMean(partsLists.market_hr),
      sector_hr: weightedMean(partsLists.sector_hr),
      subsector_hr: weightedMean(partsLists.subsector_hr),
      market_er: weightedMean(partsLists.market_er),
      sector_er: weightedMean(partsLists.sector_er),
      subsector_er: weightedMean(partsLists.subsector_er),
      residual_er: weightedMean(partsLists.residual_er),
      hedge_etfs: etfMerged,
    };

    out[lvl] = row;
  }

  return out;
}

export function notionalsFromLevelSnapshot(
  stockUsd: number,
  snapshot: LevelHedgeSnapshot,
): Array<{ etf: string; hedge_usd: number; hr: number }> {
  if (!Number.isFinite(stockUsd) || stockUsd <= 0) return [];

  const mEtf = snapshot.hedge_etfs.market;
  const sEtf = snapshot.hedge_etfs.sector;
  const uEtf = snapshot.hedge_etfs.subsector;

  const hrByEtf = new Map<string, number>();

  const acc = (ticker: string | null | undefined, hr: number | null) => {
    if (hr == null || !Number.isFinite(hr) || !ticker) return;
    hrByEtf.set(ticker, (hrByEtf.get(ticker) ?? 0) + hr);
  };

  acc(mEtf, snapshot.market_hr);
  acc(sEtf, snapshot.sector_hr);
  acc(uEtf, snapshot.subsector_hr);

  const out: Array<{ etf: string; hedge_usd: number; hr: number }> = [];
  for (const [etf, hr] of hrByEtf) {
    out.push({ etf, hr, hedge_usd: stockUsd * hr });
  }
  return out;
}
