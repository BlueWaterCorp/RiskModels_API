/**
 * L3 Risk Decomposition Service
 *
 * Shared logic for fetching L3 risk decomposition data (market, sector, subsector, residual)
 * Used by both the /api/l3-decomposition route and MCP tools.
 *
 * V3 CONTRACT COMPLIANT (uses risk-engine-v3 DAL)
 * Response field names use V3 abbreviated convention (V3_DATA_CONTRACT.md).
 */

import { resolveSymbolByTicker, fetchHistory, pivotHistory } from '@/lib/dal/risk-engine-v3';

/** Internal row series from `fetchHistory` / `pivotHistory` (V3 abbreviated wire keys). */
export interface L3DecompositionResult {
  ticker: string;
  dates: string[];
  l3_mkt_hr: (number | null)[];
  l3_sec_hr: (number | null)[];
  l3_sub_hr: (number | null)[];
  l3_mkt_er: (number | null)[];
  l3_sec_er: (number | null)[];
  l3_sub_er: (number | null)[];
  l3_res_er: (number | null)[];
  market_factor_etf: string;
  universe: string;
  data_source: string;
}

/** Wire shape for REST / OpenAPI / quickstart notebook (semantic suffixes). */
export type L3DecompositionPublicBody = {
  ticker: string;
  dates: string[];
  l3_market_hr: (number | null)[];
  l3_sector_hr: (number | null)[];
  l3_subsector_hr: (number | null)[];
  l3_market_er: (number | null)[];
  l3_sector_er: (number | null)[];
  l3_subsector_er: (number | null)[];
  l3_residual_er: (number | null)[];
  market_factor_etf: string;
  universe: string;
  data_source: string;
};

export function toL3DecompositionPublicBody(
  r: L3DecompositionResult,
): L3DecompositionPublicBody {
  return {
    ticker: r.ticker,
    dates: r.dates,
    l3_market_hr: r.l3_mkt_hr,
    l3_sector_hr: r.l3_sec_hr,
    l3_subsector_hr: r.l3_sub_hr,
    l3_market_er: r.l3_mkt_er,
    l3_sector_er: r.l3_sec_er,
    l3_subsector_er: r.l3_sub_er,
    l3_residual_er: r.l3_res_er,
    market_factor_etf: r.market_factor_etf,
    universe: r.universe,
    data_source: r.data_source,
  };
}

export class L3DecompositionService {
  /**
   * Get L3 risk decomposition for a ticker from daily Zarr-backed history (`fetchHistory`).
   * @param ticker Stock ticker symbol (e.g. AAPL)
   * @param marketFactorEtf Market factor ETF (default: SPY)
   * @param options.years Trading-calendar years of history (default 1; must match GET query `years`)
   */
  async getDecomposition(
    ticker: string,
    marketFactorEtf: string = 'SPY',
    options?: { years?: number },
  ): Promise<L3DecompositionResult | null> {
    const upperTicker = ticker.toUpperCase();
    const years = options?.years ?? 1;

    return this.getDecompositionFromSecurityHistory(upperTicker, marketFactorEtf, years);
  }

  /** V3 contract path: daily L3 series from GCS Zarr via `fetchHistory`. */
  private async getDecompositionFromSecurityHistory(
    ticker: string,
    marketFactorEtf: string,
    years: number,
  ): Promise<L3DecompositionResult | null> {
    try {
      const symbolRecord = await resolveSymbolByTicker(ticker);
      if (!symbolRecord) return null;

      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - years);
      const startDateStr = startDate.toISOString().split('T')[0]!;

      const rows = await fetchHistory(symbolRecord.symbol, [
        'l3_mkt_hr',
        'l3_sec_hr',
        'l3_sub_hr',
        'l3_mkt_er',
        'l3_sec_er',
        'l3_sub_er',
        'l3_res_er'
      ], {
        periodicity: 'daily',
        startDate: startDateStr,
        orderBy: 'asc',
      });

      if (rows.length === 0) return null;

      const pivoted = pivotHistory(rows);
      if (pivoted.length === 0) return null;

      const dates = pivoted.map(p => p.teo);

      return {
      ticker,
      dates,
      l3_mkt_hr: pivoted.map(p => p.l3_mkt_hr as number ?? null),
      l3_sec_hr: pivoted.map(p => p.l3_sec_hr as number ?? null),
      l3_sub_hr: pivoted.map(p => p.l3_sub_hr as number ?? null),
      l3_mkt_er: pivoted.map(p => p.l3_mkt_er as number ?? null),
      l3_sec_er: pivoted.map(p => p.l3_sec_er as number ?? null),
      l3_sub_er: pivoted.map(p => p.l3_sub_er as number ?? null),
      l3_res_er: pivoted.map(p => p.l3_res_er as number ?? null),
      market_factor_etf: marketFactorEtf,
      universe: 'US_EQUITY',
      data_source: 'zarr',
    };
    } catch (err) {
      console.error('[L3DecompositionService] Error for', ticker, ':', err instanceof Error ? err.message : err);
      throw err;
    }
  }
}

let _instance: L3DecompositionService | null = null;
export function getL3DecompositionService(): L3DecompositionService {
  if (!_instance) {
    _instance = new L3DecompositionService();
  }
  return _instance;
}
