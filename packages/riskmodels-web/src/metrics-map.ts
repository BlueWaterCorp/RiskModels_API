import type {
  FourBetExposure,
  RiskmodelsMetricsBlock,
  RiskmodelsMetricsMeta,
} from './types/metrics';

const MARKET_ETF = 'SPY';

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map L3 metrics + symbol meta → same four-layer shape as `POST /api/decompose`. */
export function mapMetricsToFourBet(
  m: RiskmodelsMetricsBlock,
  meta: RiskmodelsMetricsMeta | undefined,
): FourBetExposure {
  const sectorEtf = meta?.sector_etf ?? null;
  const subsectorEtf = meta?.subsector_etf ?? meta?.sector_etf ?? null;
  return {
    market: {
      er: num(m.l3_mkt_er),
      hr: num(m.l3_mkt_hr),
      hedge_etf: MARKET_ETF,
    },
    sector: {
      er: num(m.l3_sec_er),
      hr: num(m.l3_sec_hr),
      hedge_etf: sectorEtf,
    },
    subsector: {
      er: num(m.l3_sub_er),
      hr: num(m.l3_sub_hr),
      hedge_etf: subsectorEtf,
    },
    residual: {
      er: num(m.l3_res_er),
      hr: null,
      hedge_etf: null,
    },
  };
}

/** Hedge notionals: dollars of ETF per $1 long stock (negative ⇒ short ETF), matching decompose API. */
export function buildHedgeMapFromFourBet(exposure: FourBetExposure): Record<string, number> {
  const hedge: Record<string, number> = {};
  for (const name of ['market', 'sector', 'subsector'] as const) {
    const layer = exposure[name];
    if (layer.hedge_etf && layer.hr !== null) {
      hedge[layer.hedge_etf] = (hedge[layer.hedge_etf] ?? 0) + -layer.hr;
    }
  }
  return hedge;
}

/** One-line hedge copy for hero-style display. */
export function formatHedgeSummary(
  hedge: Record<string, number>,
  ticker: string,
  opts?: { maxEtfs?: number },
): string {
  const maxEtfs = opts?.maxEtfs ?? 4;
  const parts = Object.entries(hedge)
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .slice(0, maxEtfs)
    .map(([etf, ratio]) => {
      const abs = Math.abs(ratio);
      const side = ratio < 0 ? 'Short' : 'Long';
      const amt = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
      return `${side} $${amt} of ${etf}`;
    });
  if (parts.length === 0) return `No tradable hedge legs mapped for ${ticker}.`;
  return `${parts.join(', ')} per $1 of ${ticker}.`;
}
