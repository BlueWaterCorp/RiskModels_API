/**
 * Server-side readers for the figures the marketing pages print. Each one reads
 * a public production endpoint and returns null on any failure, so a page states
 * "Data unavailable" instead of printing a stale or invented value.
 */
import { RECORDED_METRICS_NVDA, RECORDED_ON } from './recorded-metrics';

const ORIGIN = 'https://riskmodels.app';

async function readJson<T>(path: string, revalidate: number, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${ORIGIN}${path}`, {
      headers,
      next: { revalidate },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface L3Hedge {
  market_hr: number | null;
  sector_hr: number | null;
  subsector_hr: number | null;
  market_er: number | null;
  sector_er: number | null;
  subsector_er: number | null;
  residual_er: number | null;
  hedge_etfs: { market: string | null; sector: string | null; subsector: string | null };
}

export interface MetricsExhibit {
  ticker: string;
  teo: string;
  l3: L3Hedge;
  metadata: { model_version: string; data_as_of: string; factor_set_id: string; universe_size: number };
  /** 'live' when read from production for this render, 'recorded' for the committed copy. */
  source: 'live' | 'recorded';
  /** Date the response was obtained (ISO day). */
  obtained: string;
}

function recorded(): MetricsExhibit {
  return {
    ticker: RECORDED_METRICS_NVDA.ticker,
    teo: RECORDED_METRICS_NVDA.teo,
    l3: RECORDED_METRICS_NVDA.hedge_levels.L3,
    metadata: RECORDED_METRICS_NVDA._metadata,
    source: 'recorded',
    obtained: RECORDED_ON,
  };
}

/** GET /api/metrics/NVDA with the public sample key; the recorded copy otherwise. */
export async function getMetricsExhibit(): Promise<MetricsExhibit> {
  const key = process.env.LLMS_TXT_PUBLIC_AGENT_KEY;
  if (!key || key.length <= 10) return recorded();
  type Raw = {
    ticker?: string;
    teo?: string;
    hedge_levels?: { L3?: L3Hedge };
    _metadata?: MetricsExhibit['metadata'];
  };
  const raw = await readJson<Raw>('/api/metrics/NVDA', 86400, { Authorization: `Bearer ${key}` });
  const l3 = raw?.hedge_levels?.L3;
  if (!raw?.teo || !l3 || !raw._metadata || typeof l3.residual_er !== 'number') return recorded();
  return {
    ticker: raw.ticker ?? 'NVDA',
    teo: raw.teo,
    l3,
    metadata: {
      model_version: raw._metadata.model_version,
      data_as_of: raw._metadata.data_as_of,
      factor_set_id: raw._metadata.factor_set_id,
      universe_size: raw._metadata.universe_size,
    },
    source: 'live',
    obtained: new Date().toISOString().slice(0, 10),
  };
}

export interface FeedEvent {
  event_id: string;
  event_type: string;
  family: string | null;
  ticker: string | null;
  company: string | null;
  event: string;
  detail: string | null;
  effective_date: string | null;
  known_date: string | null;
  source_url: string | null;
  source_label: string | null;
  status: string | null;
  flag: string | null;
}

export interface FeedSample {
  generated_at: string;
  count: number;
  latest_known_date: string | null;
  sample_through: string | null;
  sample_note: string | null;
  events: FeedEvent[];
}

/** The public sample of the event feed (/security-master-feed/latest.json). */
export async function getFeedSample(): Promise<FeedSample | null> {
  const d = await readJson<FeedSample>('/security-master-feed/latest.json', 300);
  return d && Array.isArray(d.events) && d.events.length > 0 ? d : null;
}

export interface HealthCapability {
  status: string;
  avg_latency_ms_24h: number | null;
  success_rate_24h: number | null;
}

export interface Health {
  status: string;
  timestamp: string;
  version: string;
  services: Record<string, { status: string; latency_ms: number | null }>;
  capabilities: Record<string, HealthCapability>;
  teo_coverage?: {
    latest_teo: string;
    universe_stock_count: number;
    non_null_returns_symbol_count: number;
    latest_teo_coverage_pct: number;
    latest_session_returns_pending: boolean;
  };
  coverage?: {
    history_starts: { returns: string; hedge_ratio: string; explained_risk: string; residual_share: string; lstar: string };
    universe: { label: string; as_of: string; member_count: number } | null;
    stock_records: number | null;
  };
  macro_factors?: { status: string; newest_teo?: string; stale?: boolean };
}

/** GET /api/health. */
export async function getHealth(): Promise<Health | null> {
  const d = await readJson<Health>('/api/health', 60);
  return d && typeof d.status === 'string' && d.capabilities ? d : null;
}
