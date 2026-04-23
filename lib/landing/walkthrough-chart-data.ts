import type {
  SecurityHistoryRow,
  SymbolRegistryRow,
  V3MetricKey,
} from "@/lib/dal/risk-engine-v3";

/** Mag7 set used by landing walkthrough / playground (display order). */
export const WALKTHROUGH_MAG7_TICKERS = [
  "AAPL",
  "MSFT",
  "GOOG",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
] as const;

export type WalkthroughMag7Ticker = (typeof WALKTHROUGH_MAG7_TICKERS)[number];

export const WALKTHROUGH_MAG7_NAMES: Record<string, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  GOOG: "Alphabet",
  GOOGL: "Alphabet",
  AMZN: "Amazon",
  META: "Meta Platforms",
  TSLA: "Tesla",
};

/** Shapes mirror `@riskmodels/web` — keep in sync when changing the package. */
export interface WalkthroughLinePoint {
  date: string;
  gross: number;
  marketHedged: number;
  sectorHedged: number;
  residual: number;
}

export interface WalkthroughYearBar {
  year: number;
  l1_pp: number;
  l2_pp: number;
  l3_pp: number;
  res_pp: number;
  gross_pp: number;
  n_days: number;
  data_as_of: string;
}

export interface WalkthroughSnapshot {
  ticker: string;
  symbol: string;
  name: string | null;
  asOf: string;
  sectorEtf: string | null;
  subsectorEtf: string | null;
  line: WalkthroughLinePoint[];
  bars: WalkthroughYearBar[];
}

export const WALKTHROUGH_METRIC_KEYS: V3MetricKey[] = [
  "returns_gross",
  "l1_cfr",
  "l2_cfr",
  "l3_cfr",
  "l1_fr",
  "l2_fr",
  "l3_fr",
  "l3_rr",
];

export function walkthroughStartOfYearMinus2UTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear() - 2;
  return `${y}-01-01`;
}

/**
 * Build walkthrough snapshot from long security_history rows (same semantics as
 * `GET /api/landing/mag7-hero`).
 */
export function buildWalkthroughSnapshot(
  ticker: string,
  sym: SymbolRegistryRow,
  rows: SecurityHistoryRow[],
): WalkthroughSnapshot | null {
  const byDate = new Map<
    string,
    {
      returns_gross?: number;
      l1_cfr?: number;
      l2_cfr?: number;
      l3_cfr?: number;
      l1_fr?: number;
      l2_fr?: number;
      l3_fr?: number;
      l3_rr?: number;
    }
  >();
  for (const row of rows) {
    if (row.metric_value == null) continue;
    const bucket = byDate.get(row.teo) ?? {};
    (bucket as Record<string, number>)[row.metric_key] = row.metric_value;
    byDate.set(row.teo, bucket);
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;

  let cumGross = 0;
  let cumL1 = 0;
  let cumL2 = 0;
  let cumL3 = 0;
  const line: WalkthroughLinePoint[] = [];
  for (const date of dates) {
    const b = byDate.get(date) ?? {};
    const g = b.returns_gross ?? 0;
    const c1 = b.l1_cfr ?? 0;
    const c2 = b.l2_cfr ?? 0;
    const c3 = b.l3_cfr ?? 0;
    cumGross = (1 + cumGross) * (1 + g) - 1;
    cumL1 = (1 + cumL1) * (1 + c1) - 1;
    cumL2 = (1 + cumL2) * (1 + c2) - 1;
    cumL3 = (1 + cumL3) * (1 + c3) - 1;
    line.push({
      date,
      gross: cumGross * 100,
      marketHedged: ((1 + cumGross) / (1 + cumL1) - 1) * 100,
      sectorHedged: ((1 + cumGross) / (1 + cumL2) - 1) * 100,
      residual: ((1 + cumGross) / (1 + cumL3) - 1) * 100,
    });
  }

  const byYear = new Map<
    number,
    {
      l1: number;
      l2: number;
      l3: number;
      res: number;
      gross: number;
      n: number;
      lastDate: string;
    }
  >();
  for (const date of dates) {
    const y = Number(date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const b = byDate.get(date) ?? {};
    const agg = byYear.get(y) ?? {
      l1: 1,
      l2: 1,
      l3: 1,
      res: 1,
      gross: 1,
      n: 0,
      lastDate: date,
    };
    agg.l1 *= 1 + (b.l1_fr ?? 0);
    agg.l2 *= 1 + (b.l2_fr ?? 0);
    agg.l3 *= 1 + (b.l3_fr ?? 0);
    agg.res *= 1 + (b.l3_rr ?? 0);
    agg.gross *= 1 + (b.returns_gross ?? 0);
    agg.n += 1;
    agg.lastDate = date;
    byYear.set(y, agg);
  }

  const nowYear = new Date().getUTCFullYear();
  const targetYears = [nowYear - 2, nowYear - 1, nowYear];
  const bars: WalkthroughYearBar[] = [];
  for (const y of targetYears) {
    const agg = byYear.get(y);
    if (!agg) continue;
    bars.push({
      year: y,
      l1_pp: (agg.l1 - 1) * 100,
      l2_pp: (agg.l2 - 1) * 100,
      l3_pp: (agg.l3 - 1) * 100,
      res_pp: (agg.res - 1) * 100,
      gross_pp: (agg.gross - 1) * 100,
      n_days: agg.n,
      data_as_of: agg.lastDate,
    });
  }

  const asOf = dates[dates.length - 1];

  return {
    ticker,
    symbol: sym.symbol,
    name: sym.name ?? WALKTHROUGH_MAG7_NAMES[ticker] ?? null,
    asOf,
    sectorEtf: sym.sector_etf ?? null,
    subsectorEtf: sym.subsector_etf ?? sym.sector_etf ?? null,
    line,
    bars,
  };
}

export const WALKTHROUGH_MAG7_SET = new Set<string>(WALKTHROUGH_MAG7_TICKERS);
