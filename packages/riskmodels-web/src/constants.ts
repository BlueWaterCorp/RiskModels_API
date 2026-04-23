/** Keep aligned with `lib/landing/walkthrough-chart-data.ts` (server cannot import this package). */
export const WALKTHROUGH_MAG7_TICKERS = [
  'AAPL',
  'MSFT',
  'GOOG',
  'AMZN',
  'NVDA',
  'META',
  'TSLA',
] as const;

export type WalkthroughMag7Ticker = (typeof WALKTHROUGH_MAG7_TICKERS)[number];

export const WALKTHROUGH_MAG7_NAMES: Record<string, string> = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  GOOG: 'Alphabet',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon',
  META: 'Meta Platforms',
  TSLA: 'Tesla',
};

export const WALKTHROUGH_MAG7_SET = new Set<string>(WALKTHROUGH_MAG7_TICKERS);

/** Send on `GET /api/metrics/{ticker}` to apply playground-only rate limits (portal session). */
export const RISKMODELS_PLAYGROUND_HEADER = 'X-RiskModels-Playground';
export const RISKMODELS_PLAYGROUND_VALUE = '1';
