/**
 * A recorded response from GET /api/metrics/NVDA, abridged to the fields the
 * site prints. Recorded against production on the date below; the home page
 * shows it, with that date, whenever the live request is unavailable.
 */
export const RECORDED_ON = '2026-11-24';

export const RECORDED_METRICS_NVDA = {
  ticker: 'NVDA',
  teo: '2026-11-23',
  hedge_levels: {
    L3: {
      market_hr: -0.620746552944183,
      sector_hr: 0.0540849901735783,
      subsector_hr: -0.599617719650269,
      market_er: 0.414067208766937,
      sector_er: 0.107482179999352,
      subsector_er: -0.00131262454669923,
      residual_er: 0.479763239622116,
      hedge_etfs: { market: 'SPY', sector: 'XLK', subsector: 'SMH' },
    },
  },
  _metadata: {
    model_version: '3.0',
    data_as_of: '2026-11-23',
    factor_set_id: 'SPY_uni_mc_3000',
    universe_size: 3292,
  },
} as const;
