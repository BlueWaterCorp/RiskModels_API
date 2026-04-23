import { RISKMODELS_PLAYGROUND_HEADER, RISKMODELS_PLAYGROUND_VALUE } from './constants';

export interface FetchRiskmodelsMetricsOptions extends RequestInit {
  /** When true, sends playground header (session-only rate limit on riskmodels.app). */
  playground?: boolean;
}

export function fetchRiskmodelsMetrics(
  baseUrl: string,
  ticker: string,
  init?: FetchRiskmodelsMetricsOptions,
): Promise<Response> {
  const { playground, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (playground) {
    headers.set(RISKMODELS_PLAYGROUND_HEADER, RISKMODELS_PLAYGROUND_VALUE);
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/metrics/${encodeURIComponent(ticker)}`;
  return fetch(url, { ...rest, headers });
}
