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

export interface L3DecompositionResult {
  ticker: string;
  dates: string[];
  // V3 abbreviated metric names (V3_DATA_CONTRACT.md)
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

export class L3DecompositionService {
  /**
   * Get L3 risk decomposition for a ticker
   * @param ticker Stock ticker symbol (e.g. AAPL)
   * @param marketFactorEtf Market factor ETF (default: SPY)
   * @param dataSource Data source: 'factset' (default, from security_history)
   * @returns L3 decomposition data with time series
   */
  async getDecomposition(
    ticker: string,
    marketFactorEtf: string = 'SPY',
    dataSource: string = 'factset'
  ): Promise<L3DecompositionResult | null> {
    const upperTicker = ticker.toUpperCase();

    return this.getDecompositionFromSecurityHistory(upperTicker, marketFactorEtf);
  }

  /** V3 contract path: query security_history with V3 metric keys. */
  private async getDecompositionFromSecurityHistory(
    ticker: string,
    marketFactorEtf: string
  ): Promise<L3DecompositionResult | null> {
    try {
      const symbolRecord = await resolveSymbolByTicker(ticker);
      if (!symbolRecord) return null;

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
      data_source: 'factset',
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
