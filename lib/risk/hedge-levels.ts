/**
 * Canonical L1/L2/L3 hedge snapshot block — SSOT across REST/MCP/SDKs.
 *
 * Each level is a standalone hedge solution (orthogonal cascade semantics
 * unchanged from SEMANTIC_ALIASES / lstar-service). Null legs mean that leg
 * is not part of the level.
 *
 * HR/ER wiring: {@link LEVEL_SCALAR_WIRE} is the only mapping from semantic
 * `market_hr` / `sector_hr` / … to V3 keys — L1 uses `l1_*`, L2 uses `l2_*`, L3 uses `l3_*`
 * (never share `l3_mkt_hr` across levels).
 */

export type HedgeLevelId = "L1" | "L2" | "L3";

export type HedgeRecommendedLevel = "L1" | "L2" | "L3";

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
  /** Economic recommendation layer (see computeHedgeRecommendationSnapshot). */
  recommended_level?: HedgeRecommendedLevel | null;
  /** Statistical Lstar gate (orthogonal cascade pick). Optional audit field. */
  statistical_lstar?: HedgeRecommendedLevel | null;
}

/** Subset of V3 wire metric keys consumed by {@link buildHedgeLevels}. */
export type WireMetricsForHedgeLevels = Partial<{
  l1_mkt_hr: unknown;
  l1_mkt_er: unknown;
  l1_res_er: unknown;
  l2_mkt_hr: unknown;
  l2_sec_hr: unknown;
  l2_mkt_er: unknown;
  l2_sec_er: unknown;
  l2_res_er: unknown;
  l3_mkt_hr: unknown;
  l3_sec_hr: unknown;
  l3_sub_hr: unknown;
  l3_mkt_er: unknown;
  l3_sec_er: unknown;
  l3_sub_er: unknown;
  l3_res_er: unknown;
}>;

export type HedgeLevelWireKey = keyof WireMetricsForHedgeLevels;

/**
 * Single SSOT mapping from semantic HR/ER fields → V3 zarr wire keys **per cascade level**.
 * Invariant: L1.market_hr must always come from `l1_mkt_hr`, L2.market_hr from `l2_mkt_hr`,
 * L3.market_hr from `l3_mkt_hr` — never reuse another level's market/sector/subsector hedge ratio.
 *
 * {@link buildHedgeLevels} reads only through this table so new code cannot silently alias levels.
 */
export const LEVEL_SCALAR_WIRE: Record<
  HedgeLevelId,
  {
    market_hr: HedgeLevelWireKey;
    sector_hr: HedgeLevelWireKey | null;
    subsector_hr: HedgeLevelWireKey | null;
    market_er: HedgeLevelWireKey | null;
    sector_er: HedgeLevelWireKey | null;
    subsector_er: HedgeLevelWireKey | null;
    residual_er: HedgeLevelWireKey | null;
  }
> = {
  L1: {
    market_hr: "l1_mkt_hr",
    sector_hr: null,
    subsector_hr: null,
    market_er: "l1_mkt_er",
    sector_er: null,
    subsector_er: null,
    residual_er: "l1_res_er",
  },
  L2: {
    market_hr: "l2_mkt_hr",
    sector_hr: "l2_sec_hr",
    subsector_hr: null,
    market_er: "l2_mkt_er",
    sector_er: "l2_sec_er",
    subsector_er: null,
    residual_er: "l2_res_er",
  },
  L3: {
    market_hr: "l3_mkt_hr",
    sector_hr: "l3_sec_hr",
    subsector_hr: "l3_sub_hr",
    market_er: "l3_mkt_er",
    sector_er: "l3_sec_er",
    subsector_er: "l3_sub_er",
    residual_er: "l3_res_er",
  },
};

export interface HedgeEtfHints {
  market_etf: string;
  sector_etf: string | null;
  subsector_etf: string | null;
}

export interface BuildHedgeLevelsOptions {
  recommended_level?: HedgeRecommendedLevel | null;
  statistical_lstar?: HedgeRecommendedLevel | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickWire(m: WireMetricsForHedgeLevels, key: HedgeLevelWireKey | null): number | null {
  if (key == null) return null;
  return num(m[key]);
}

function hedgeEtfs(etfs: HedgeEtfHints): LevelHedgeSnapshot["hedge_etfs"] {
  const market = etfs.market_etf || "SPY";
  const sector = etfs.sector_etf ?? null;
  const sub = etfs.subsector_etf ?? sector;
  return { market, sector, subsector: sub };
}

function etfsForStandaloneLevel(level: HedgeLevelId, he: LevelHedgeSnapshot["hedge_etfs"]): LevelHedgeSnapshot["hedge_etfs"] {
  if (level === "L1") {
    return { market: he.market, sector: null, subsector: null };
  }
  if (level === "L2") {
    return { market: he.market, sector: he.sector, subsector: null };
  }
  return { market: he.market, sector: he.sector, subsector: he.subsector };
}

function levelSnapshotFromWire(level: HedgeLevelId, m: WireMetricsForHedgeLevels, heResolved: LevelHedgeSnapshot["hedge_etfs"]): LevelHedgeSnapshot {
  const cfg = LEVEL_SCALAR_WIRE[level];
  return {
    market_hr: pickWire(m, cfg.market_hr),
    sector_hr: pickWire(m, cfg.sector_hr),
    subsector_hr: pickWire(m, cfg.subsector_hr),
    market_er: pickWire(m, cfg.market_er),
    sector_er: pickWire(m, cfg.sector_er),
    subsector_er: pickWire(m, cfg.subsector_er),
    residual_er: pickWire(m, cfg.residual_er),
    hedge_etfs: etfsForStandaloneLevel(level, heResolved),
  };
}

/**
 * Maps flat V3 metrics + resolved ETF mnemonics to the canonical hedge_levels shape.
 */
export function buildHedgeLevels(
  m: WireMetricsForHedgeLevels,
  etfs: HedgeEtfHints,
  options?: BuildHedgeLevelsOptions,
): HedgeLevelsBlock {
  const he = hedgeEtfs(etfs);

  const L1 = levelSnapshotFromWire("L1", m, he);
  const L2 = levelSnapshotFromWire("L2", m, he);
  const L3 = levelSnapshotFromWire("L3", m, he);

  const out: HedgeLevelsBlock = { L1, L2, L3 };
  if (options?.recommended_level !== undefined && options.recommended_level !== null) {
    out.recommended_level = options.recommended_level;
  }
  if (options?.statistical_lstar !== undefined && options.statistical_lstar !== null) {
    out.statistical_lstar = options.statistical_lstar;
  }
  return out;
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

/**
 * Holdings-weighted means of semantic HR/ER fields per level — mirrors SDK
 * `portfolio_hedge_ratios` / `portfolio_l3_er_weighted_mean` descriptively.
 *
 * ETF tickers on the aggregate row are placeholders (portfolio mixes sectors).
 */
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

    const partsLists: Record<(typeof SNAPSHOT_SCALAR_KEYS)[number], Array<{ w: number; v: number | null }>> = {
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
      const b = blocksByTicker[ticker];
      if (!b || !Number.isFinite(w) || w <= 0) continue;
      const s = b[lvl];
      for (const k of SNAPSHOT_SCALAR_KEYS) {
        partsLists[k].push({ w, v: s[k] });
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

/**
 * Dollars of each ETF hedge leg for a USD stock position using one cascade level's HR scalars.
 * HR convention: dollars of ETF per $1 stock (ERM3 hedge weights).
 *
 * Same-ETF legs (e.g. sector falls back to subsector ticker) consolidate by summing HR
 * before scaling to notionals — matches `/decompose` hedge map merging.
 */
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
