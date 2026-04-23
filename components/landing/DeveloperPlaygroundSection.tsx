'use client';

/**
 * Phase 2 developer playground: GET /api/metrics + JSON + @riskmodels/web visuals.
 * Anonymous: static preview. Signed-in: live metrics with playground rate limit header.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import {
  ApiCallTabs,
  Erm3FourBetCard,
  Erm3HedgeMap,
  LineageStamp,
  RISKMODELS_PLAYGROUND_HEADER,
  RISKMODELS_PLAYGROUND_VALUE,
  buildHedgeMapFromFourBet,
  formatHedgeSummary,
  mapMetricsToFourBet,
  type RiskmodelsMetricsResponse,
} from '@riskmodels/web';
import { cn } from '@/lib/cn';

const SAMPLE_METRICS_BODY: RiskmodelsMetricsResponse = {
  ticker: 'NVDA',
  teo: '2026-04-21',
  metrics: {
    l3_mkt_er: 0.42,
    l3_sec_er: 0.18,
    l3_sub_er: 0.12,
    l3_res_er: 0.28,
    l3_mkt_hr: 1.05,
    l3_sec_hr: 0.32,
    l3_sub_hr: 0.58,
  },
  meta: {
    sector_etf: 'XLK',
    subsector_etf: 'SMH',
  },
  _metadata: {
    data_as_of: '2026-04-22',
    model_version: 'ERM3',
    factor_set_id: 'v3',
    universe_size: 3000,
  },
};

type TickerSearchHit = { ticker: string; company_name?: string };

export default function DeveloperPlaygroundSection() {
  const [user, setUser] = useState<User | null>(null);
  const [ticker, setTicker] = useState('NVDA');
  const [draft, setDraft] = useState('NVDA');
  const [suggestions, setSuggestions] = useState<TickerSearchHit[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metricsJson, setMetricsJson] = useState<RiskmodelsMetricsResponse | null>(null);
  const [jsonOpen, setJsonOpen] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getUser().then(({ data: { user: u } }) => setUser(u));
    return () => subscription.unsubscribe();
  }, []);

  const searchTickers = useCallback(async (q: string) => {
    const t = q.trim();
    if (t.length < 1) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/tickers?search=${encodeURIComponent(t)}`);
      const data = await res.json();
      const sug: TickerSearchHit[] = Array.isArray(data.suggestions)
        ? data.suggestions.map((s: { ticker: string; company_name?: string }) => ({
            ticker: s.ticker,
            company_name: s.company_name,
          }))
        : [];
      setSuggestions(sug);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void searchTickers(draft);
    }, 280);
    return () => window.clearTimeout(id);
  }, [draft, searchTickers]);

  const runMetrics = useCallback(
    async (symOverride?: string) => {
      const sym = (symOverride ?? ticker).trim().toUpperCase();
      if (!sym || !user) return;
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {
          [RISKMODELS_PLAYGROUND_HEADER]: RISKMODELS_PLAYGROUND_VALUE,
        };
        const res = await fetch(`/api/metrics/${encodeURIComponent(sym)}`, {
          credentials: 'include',
          headers,
        });
        const data = (await res.json()) as RiskmodelsMetricsResponse & { error?: string; message?: string };
        if (!res.ok) {
          const msg =
            typeof data.message === 'string'
              ? data.message
              : typeof data.error === 'string'
                ? data.error
                : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        setMetricsJson(data as RiskmodelsMetricsResponse);
      } catch (e) {
        setMetricsJson(null);
        setError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        setLoading(false);
      }
    },
    [ticker, user],
  );

  useEffect(() => {
    if (!user) {
      setMetricsJson(null);
      return;
    }
    void runMetrics(ticker.trim().toUpperCase());
    // Intentionally only when session appears — changing ticker uses the Run button or suggestion row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const previewBody: RiskmodelsMetricsResponse | null = !user ? SAMPLE_METRICS_BODY : metricsJson;

  const exposure = useMemo(() => {
    if (!previewBody?.metrics) return null;
    return mapMetricsToFourBet(
      previewBody.metrics,
      previewBody.meta ?? { sector_etf: null, subsector_etf: null },
    );
  }, [previewBody]);

  const hedge = useMemo(() => {
    if (!exposure) return {};
    return buildHedgeMapFromFourBet(exposure);
  }, [exposure]);

  const displayBody: RiskmodelsMetricsResponse | null = previewBody;
  const dataAsOf =
    displayBody?._metadata?.data_as_of ?? displayBody?._data_health?.data_as_of ?? null;

  const artifactId =
    displayBody?.ticker && dataAsOf
      ? `r1_quicklook_${displayBody.ticker.toUpperCase()}_${dataAsOf}`
      : null;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://riskmodels.app';

  return (
    <section
      id="developer-playground"
      className="relative scroll-mt-20 border-t border-zinc-800/80 bg-zinc-950 px-4 py-14 sm:px-6 lg:px-8"
      aria-label="Developer metrics playground"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
            Phase 2 · Developer playground
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            One call. Full JSON. Four-bet card.
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Signed-in users hit{' '}
            <span className="font-mono text-zinc-300">GET /api/metrics/&lt;ticker&gt;</span> with session auth
            (playground rate limit). Charts for 2y+YTD live in{' '}
            <span className="font-mono text-zinc-300">@riskmodels/web</span> + the walkthrough above.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5 shadow-2xl ring-1 ring-white/[0.06] sm:p-7">
          {!user ? (
            <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
              <a href="/get-key" className="font-semibold text-sky-400 underline-offset-2 hover:underline">
                Sign in
              </a>{' '}
              to run metrics on any ticker. Below is a static <span className="font-mono">NVDA</span>-shaped preview.
            </div>
          ) : null}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="relative min-w-0 flex-1">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Ticker
              </label>
              <input
                type="text"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.toUpperCase());
                  setShowSuggest(true);
                }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => window.setTimeout(() => setShowSuggest(false), 180)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                placeholder="NVDA"
                autoComplete="off"
                spellCheck={false}
              />
              {showSuggest && suggestions.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 py-1 shadow-xl">
                  {suggestions.map((s) => (
                    <li key={s.ticker}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-zinc-800/80"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setDraft(s.ticker);
                          setTicker(s.ticker);
                          setShowSuggest(false);
                          void runMetrics(s.ticker);
                        }}
                      >
                        <span className="font-mono font-semibold text-white">{s.ticker}</span>
                        {s.company_name ? (
                          <span className="text-xs text-zinc-500">{s.company_name}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button
              type="button"
              disabled={!user || loading}
              onClick={() => {
                const sym = draft.trim().toUpperCase();
                setTicker(sym);
                void runMetrics(sym);
              }}
              className={cn(
                'shrink-0 rounded-lg px-5 py-2.5 text-sm font-semibold transition',
                user
                  ? 'bg-sky-600 text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-500',
              )}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </span>
              ) : (
                'Run GET /metrics'
              )}
            </button>
          </div>

          {user ? (
            <p className="mt-2 text-[11px] text-zinc-500">
              Playground limit: 10 requests/minute per signed-in user (header{' '}
              <span className="font-mono text-zinc-400">{RISKMODELS_PLAYGROUND_HEADER}</span>).
            </p>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          {artifactId ? (
            <p className="mt-4 font-mono text-[11px] text-zinc-500">
              artifact_id (client): <span className="text-zinc-300">{artifactId}</span>
            </p>
          ) : null}

          <div className="mt-6">
            <ApiCallTabs
              ticker={(displayBody?.ticker ?? draft.trim().toUpperCase()) || 'NVDA'}
              baseUrl={baseUrl}
              apiKeyPreview="rm_live_••••••••"
            />
          </div>

          <details
            open={jsonOpen}
            onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}
            className="mt-6 rounded-xl border border-zinc-700/80 bg-zinc-950/50"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
              {jsonOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Raw JSON
            </summary>
            <pre className="max-h-[min(420px,50vh)] overflow-auto border-t border-zinc-800 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(displayBody ?? (user ? {} : SAMPLE_METRICS_BODY), null, 2)}
            </pre>
          </details>

          {exposure && displayBody ? (
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <Erm3FourBetCard exposure={exposure} asOfLabel={dataAsOf} />
              <Erm3HedgeMap hedge={hedge} />
            </div>
          ) : null}

          {displayBody ? (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-black/30 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Hedge summary</p>
              <p className="text-sm leading-relaxed text-zinc-200">
                {formatHedgeSummary(hedge, displayBody.ticker ?? ticker)}
              </p>
            </div>
          ) : null}

          {displayBody ? (
            <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Lineage</p>
              <LineageStamp body={displayBody} />
            </div>
          ) : user ? (
            <p className="mt-6 text-center text-sm text-zinc-500">Fetching metrics…</p>
          ) : null}

          <p className="mt-6 text-center text-[11px] text-zinc-600">
            npm package <span className="font-mono text-zinc-400">@riskmodels/web</span> — see{' '}
            <span className="font-mono text-zinc-500">packages/riskmodels-web/README.md</span> in this repo.
          </p>
        </div>
      </div>
    </section>
  );
}
