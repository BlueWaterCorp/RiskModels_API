'use client';

/**
 * Live Demo / Playground — homepage walkthrough.
 * Anonymous: Mag7 charts from GET /api/landing/mag7-hero (static example).
 * Signed-in: POST /api/decompose + GET /api/landing/walkthrough-chart per ticker (session cookies).
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Search, ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/cn';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { WalkthroughSnapshot } from '@/lib/landing/walkthrough-chart-data';
import { WALKTHROUGH_MAG7_TICKERS } from '@/lib/landing/walkthrough-chart-data';
import {
  ERM3_WALKTHROUGH_LINE_SERIES,
  Erm3WalkthroughLineChart,
  Erm3YearlyAttributionBars,
} from '@riskmodels/web';

// --- Types ---

interface Mag7BatchResponse {
  tickers: string[];
  snapshots: Record<string, WalkthroughSnapshot>;
  data_as_of: string;
}

interface DecomposeExposure {
  market: { er: number | null; hr: number | null; hedge_etf: string | null };
  sector: { er: number | null; hr: number | null; hedge_etf: string | null };
  subsector: { er: number | null; hr: number | null; hedge_etf: string | null };
  residual: { er: number | null; hr: number | null; hedge_etf: string | null };
}

interface DecomposeApiBody {
  ticker: string;
  data_as_of?: string;
  exposure: DecomposeExposure;
  hedge: Record<string, number>;
}

const MAG7_ORDER = [...WALKTHROUGH_MAG7_TICKERS];
const DEFAULT_TICKER = 'TSLA';
/** How long each peel step stays on screen during auto-play (ms). */
const AUTO_STEP_INTERVAL_MS = 3200;

/** Concise residual copy — punchy, finance-dashboard tone. */
const RESIDUAL_PANEL_TEXT =
  'After SPY, sector, and sub-sector sleeves are hedged away, the residual is the slice of return that does not load on tradable ETFs — the cleanest day-to-day read on company-specific performance. On the line, Step 4 isolates it; in the bars, the top (blue) segment shows how much of each year compounded from this residual leg.';

const STEPS = [
  {
    id: 1,
    title: 'Market factor',
    subtitle: 'Most of the move is broad beta.',
    description:
      'The first hedge strips out the broad market regime that SPY explains — most of the directional move in a name like this is still “just beta.”',
  },
  {
    id: 2,
    title: 'Sector factor',
    subtitle: 'Tech beta is the next layer.',
    description:
      'After the market sleeve, sector ETFs (e.g. XLK) capture the next chunk of co-movement — what’s left is more residual, but not yet “pure stock.”',
  },
  {
    id: 3,
    title: 'Sub-sector factor',
    subtitle: 'Industry concentration gets isolated.',
    description:
      'A narrower industry sleeve (semis, software, etc.) pulls out the shared theme trades so you can see how much is truly name-specific.',
  },
  {
    id: 4,
    title: 'Residual',
    subtitle: 'What remains is the stock-specific view.',
    description:
      'After market, sector, and sub-sector are hedged away, the residual is the cleanest read on what the stock did on its own — the piece that does not load on those tradable factors.',
  },
] as const;

export default function LivePlaygroundDemo() {
  const [user, setUser] = useState<User | null>(null);
  const [batch, setBatch] = useState<Mag7BatchResponse | null>(null);
  const [batchLoading, setBatchLoading] = useState(true);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [selectedTicker, setSelectedTicker] = useState(DEFAULT_TICKER);
  const [currentStep, setCurrentStep] = useState(1);
  /** When false, step advances 1→4→1 on a timer so users see the peel sequence. */
  const [tourPaused, setTourPaused] = useState(false);

  const [liveSnapshot, setLiveSnapshot] = useState<WalkthroughSnapshot | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [walkError, setWalkError] = useState<string | null>(null);
  const [decomposeBody, setDecomposeBody] = useState<DecomposeApiBody | null>(null);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);

  const [searchDraft, setSearchDraft] = useState('');

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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setBatchLoading(true);
      setBatchError(null);
      try {
        const res = await fetch('/api/landing/mag7-hero', { method: 'GET' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
        if (!cancelled) setBatch(json as Mag7BatchResponse);
      } catch (e) {
        if (!cancelled) setBatchError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        if (!cancelled) setBatchLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setLiveSnapshot(null);
      setDecomposeBody(null);
      setWalkError(null);
      setDecomposeError(null);
      setLiveLoading(false);
      setSelectedTicker((cur) =>
        (MAG7_ORDER as readonly string[]).includes(cur) ? cur : DEFAULT_TICKER,
      );
      return;
    }

    const ticker = selectedTicker.trim().toUpperCase();
    if (!ticker) return;

    let cancelled = false;
    setLiveLoading(true);
    setWalkError(null);
    setDecomposeError(null);

    const run = async () => {
      try {
        const [decRes, walkRes] = await Promise.all([
          fetch('/api/decompose', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker }),
          }),
          fetch(`/api/landing/walkthrough-chart?ticker=${encodeURIComponent(ticker)}`, {
            credentials: 'include',
          }),
        ]);

        const decJson = await decRes.json().catch(() => ({}));
        const walkJson = await walkRes.json().catch(() => ({}));

        if (cancelled) return;

        if (walkRes.ok && walkJson?.snapshot) {
          setLiveSnapshot(walkJson.snapshot as WalkthroughSnapshot);
          setWalkError(null);
        } else {
          setLiveSnapshot(null);
          setWalkError(
            typeof walkJson?.error === 'string'
              ? walkJson.error
              : `Chart data failed (${walkRes.status})`,
          );
        }

        if (decRes.ok && decJson?.exposure) {
          setDecomposeBody(decJson as DecomposeApiBody);
          setDecomposeError(null);
        } else {
          setDecomposeBody(null);
          setDecomposeError(
            typeof decJson?.error === 'string'
              ? decJson.error
              : typeof decJson?.message === 'string'
                ? decJson.message
                : `Decompose failed (${decRes.status})`,
          );
        }
      } catch (e) {
        if (cancelled) return;
        setWalkError(e instanceof Error ? e.message : 'Request failed');
        setLiveSnapshot(null);
        setDecomposeBody(null);
        setDecomposeError('Network error');
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user, selectedTicker]);

  useEffect(() => {
    if (!user) {
      setSearchDraft('');
      return;
    }
    const t = searchDraft.trim().toUpperCase();
    if (t.length < 2) return;
    const id = window.setTimeout(() => {
      setSelectedTicker(t);
    }, 450);
    return () => window.clearTimeout(id);
  }, [searchDraft, user]);

  // Fresh peel tour when the user picks a different ticker.
  useEffect(() => {
    setCurrentStep(1);
    setTourPaused(false);
  }, [selectedTicker]);

  const snapshots = useMemo(() => batch?.snapshots ?? {}, [batch?.snapshots]);

  const effectiveSnapshot = useMemo((): WalkthroughSnapshot | null => {
    const want = selectedTicker.trim().toUpperCase();
    // Prefer fresh signed-in snapshot when it matches the current selection.
    if (user && liveSnapshot && liveSnapshot.ticker.trim().toUpperCase() === want) {
      return liveSnapshot;
    }
    // Fallback to the batch payload for Mag7 tickers — keeps charts visible while
    // the signed-in walkthrough request is in flight, and serves anonymous users.
    return snapshots[want] ?? null;
  }, [user, liveSnapshot, selectedTicker, snapshots]);

  const headerTitle = useMemo(() => {
    const t = effectiveSnapshot?.ticker ?? decomposeBody?.ticker ?? selectedTicker;
    const name = effectiveSnapshot?.name ?? null;
    if (name) return `${t} · ${name}`;
    return `${t} · —`;
  }, [effectiveSnapshot, decomposeBody, selectedTicker]);

  const headerThrough = effectiveSnapshot?.asOf ?? decomposeBody?.data_as_of ?? batch?.data_as_of ?? '—';

  const onPickMag7 = (t: string) => {
    setSearchDraft('');
    setSelectedTicker(t);
  };

  const hasLineData = !!effectiveSnapshot?.line?.length;

  useEffect(() => {
    if (tourPaused || !hasLineData) return;
    const id = window.setInterval(() => {
      setCurrentStep((s) => (s >= 4 ? 1 : s + 1));
    }, AUTO_STEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tourPaused, hasLineData]);

  const stepMeta = STEPS[currentStep - 1];

  const chartRows = useMemo(() => {
    if (!effectiveSnapshot?.line?.length) return [];
    return effectiveSnapshot.line.map((p) => ({
      date: p.date,
      gross: p.gross,
      marketHedged: p.marketHedged,
      sectorHedged: p.sectorHedged,
      residual: p.residual,
    }));
  }, [effectiveSnapshot]);

  // Only show the spinner when we truly have nothing to render. Once a snapshot
  // (live or batch fallback) is available, the chart stays painted and we let
  // the small header pip indicate background refresh.
  const showChartLoading = !effectiveSnapshot && (batchLoading || liveLoading);

  const chartErrorMsg = !effectiveSnapshot ? walkError ?? batchError : null;
  const showChartError = !!chartErrorMsg && !effectiveSnapshot;
  const refreshing = !!user && liveLoading && !!effectiveSnapshot;

  return (
    <section
      id="live-playground"
      className="relative scroll-mt-20 bg-zinc-950 px-4 pb-14 pt-10 sm:px-6 lg:px-8"
      aria-label="Live demo playground"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400/90">
            Live demo / Playground
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Peel the layers in real data
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            See exactly what each position exposes you to &mdash; market, sector, theme,
            and the company itself &mdash; and get the ETF trades to hedge what you
            don&rsquo;t want. The cumulative line and yearly bars use the same snapshot
            for Mag7 (cached) and for any ticker once you&rsquo;re signed in; decompose uses{' '}
            <span className="font-mono text-zinc-300">POST /api/decompose</span> (two years plus YTD).
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/35 p-5 shadow-2xl ring-1 ring-white/[0.06] sm:p-7">
          {/* Header: prominent ticker on the left, ticker controls on the right */}
          <div className="flex flex-col gap-4 border-b border-zinc-800/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-3xl font-bold tracking-tight text-white sm:text-4xl">
                {headerTitle}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
                <span>
                  through <span className="font-mono text-zinc-200">{headerThrough}</span>
                </span>
                {refreshing ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> Refreshing
                  </span>
                ) : user && decomposeBody && !decomposeError ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Live API
                  </span>
                ) : null}
                {user && decomposeError ? (
                  <span
                    className="text-[11px] text-amber-400/90"
                    title={decomposeError}
                  >
                    Decompose: {decomposeError}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-2 lg:items-end">
              <div className="flex flex-wrap gap-1.5">
                {MAG7_ORDER.map((t) => {
                  const has = !!snapshots[t];
                  const active = selectedTicker === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onPickMag7(t)}
                      disabled={!user && !has && batchLoading}
                      className={cn(
                        'rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wide transition',
                        active
                          ? 'border-sky-500/80 bg-sky-500/15 text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]'
                          : has || user
                            ? 'border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-500 hover:text-white'
                            : 'cursor-not-allowed border-zinc-800/70 text-zinc-600',
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value.toUpperCase())}
                  placeholder={user ? 'Any ticker…' : 'Sign in for any ticker'}
                  disabled={!user}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(
                    'w-full rounded-md border py-1.5 pl-8 pr-7 font-mono text-xs tracking-wider text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1',
                    user
                      ? 'border-zinc-700 bg-zinc-950 focus:border-sky-500 focus:ring-sky-500/40'
                      : 'cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-500 placeholder:text-zinc-600',
                  )}
                  aria-label="Search any ticker"
                />
                {user && liveLoading ? (
                  <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-zinc-500" />
                ) : null}
                {!user ? (
                  <a
                    href="/get-key"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-sky-400/90 underline-offset-2 hover:underline"
                  >
                    Sign in
                  </a>
                ) : null}
              </div>
            </div>
          </div>

          {/* Charts — directly under ticker so the walkthrough reads top-down */}
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/50 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  2y + YTD, cumulative %
                </h3>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-400/80">
                  Line peels with each step
                </span>
              </div>
              <div className="mb-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-zinc-300">
                  {ERM3_WALKTHROUGH_LINE_SERIES.map((s, i) => {
                    const dim = i >= currentStep;
                    return (
                      <span
                        key={s.key}
                        className={cn(
                          'inline-flex items-center gap-1.5 transition',
                          dim ? 'opacity-30' : 'opacity-100',
                        )}
                      >
                        <span
                          className="inline-block h-2 w-5 shrink-0 rounded-sm"
                          style={{
                            backgroundColor: s.color,
                            opacity: s.key === 'gross' ? 0.85 : 1,
                            backgroundImage: s.dash
                              ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 8px)`
                              : undefined,
                          }}
                        />
                        {s.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="h-[300px] w-full min-w-0 sm:h-[340px]">
                {showChartLoading ? (
                  <LoadingState />
                ) : showChartError ? (
                  <ErrorState message={chartErrorMsg!} />
                ) : effectiveSnapshot && chartRows.length ? (
                  <Erm3WalkthroughLineChart rows={chartRows} activeStep={currentStep} height="100%" />
                ) : (
                  <div className="flex h-full items-center text-sm text-zinc-500">No line data.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/50 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Return attribution — per year
                </h3>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  2024 · 2025 · YTD
                </span>
              </div>
              <div className="h-[300px] w-full min-w-0 sm:h-[340px]">
                {showChartLoading ? (
                  <LoadingState />
                ) : showChartError ? (
                  <ErrorState message={chartErrorMsg!} />
                ) : effectiveSnapshot?.bars?.length ? (
                  <Erm3YearlyAttributionBars
                    bars={effectiveSnapshot.bars}
                    visibleThrough={currentStep}
                    sectorEtf={effectiveSnapshot.sectorEtf}
                    subsectorEtf={effectiveSnapshot.subsectorEtf}
                    hatchIdPrefix="lpd"
                  />
                ) : (
                  <div className="flex h-full items-center text-sm text-zinc-500">No bar data.</div>
                )}
              </div>
            </div>
          </div>

          {/* Residual explanation */}
          <div className="mt-5 rounded-xl border border-sky-900/30 bg-sky-950/15 px-4 py-3">
            <p className="text-[13px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-sky-300">Residual — </span>
              {RESIDUAL_PANEL_TEXT}
            </p>
          </div>

          {/* STEP cards + arrow rail + auto-play */}
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
              <span className="text-zinc-500">
                {hasLineData
                  ? tourPaused
                    ? 'Paused — pick a step or resume auto-play'
                    : 'Auto-cycling 1 → 4 — click a card to pause'
                  : 'Click 1 → 4 to peel layers'}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-zinc-600">{currentStep} / 4</span>
                {hasLineData ? (
                  <button
                    type="button"
                    onClick={() => setTourPaused((p) => !p)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-600/80 bg-zinc-900/80 px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-zinc-200 transition hover:border-zinc-500 hover:text-white"
                  >
                    {tourPaused ? (
                      <>
                        <Play className="h-3 w-3" aria-hidden />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3" aria-hidden />
                        Pause
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((item) => {
                const on = currentStep === item.id;
                const done = currentStep > item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTourPaused(true);
                      setCurrentStep(item.id);
                    }}
                    className={cn(
                      'group relative overflow-hidden rounded-xl border bg-zinc-950/70 px-3.5 py-3 text-left transition',
                      on
                        ? 'border-sky-500 ring-1 ring-sky-500/40 shadow-[0_0_36px_-12px_rgba(56,189,248,0.55)]'
                        : 'border-zinc-700/80 hover:border-zinc-500',
                    )}
                  >
                    {/* progress accent bar at top */}
                    <span
                      className={cn(
                        'absolute inset-x-0 top-0 h-[2px] transition',
                        on ? 'bg-sky-500' : done ? 'bg-emerald-600/60' : 'bg-transparent',
                      )}
                      aria-hidden
                    />
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition',
                          on
                            ? 'bg-sky-500 text-white'
                            : done
                              ? 'bg-emerald-700/60 text-emerald-100'
                              : 'bg-zinc-800 text-zinc-400',
                        )}
                      >
                        {item.id}
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                        STEP
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-white">{item.title}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                      {item.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
            {hasLineData ? (
              <StepArrowRail currentStep={currentStep} className="mt-4" />
            ) : null}
          </div>

          {currentStep !== 4 ? (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-400">Step {stepMeta.id} — {stepMeta.title}:</span>{' '}
              {stepMeta.description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Compact 1 —▶ 2 —▶ 3 —▶ 4 rail under the step cards; connectors light as each layer peels. */
function StepArrowRail({ currentStep, className }: { currentStep: number; className?: string }) {
  const step = Math.min(4, Math.max(1, currentStep));
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      role="img"
      aria-label={`Walkthrough at peel step ${step} of 4`}
    >
      <div className="flex max-w-md items-center sm:max-w-lg">
        {[1, 2, 3, 4].map((n, idx) => (
          <div key={n} className="flex items-center">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-300',
                step === n
                  ? 'border-sky-400 bg-sky-500/25 text-sky-100 shadow-[0_0_20px_-4px_rgba(56,189,248,0.65)]'
                  : step > n
                    ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-100/90'
                    : 'border-zinc-700 bg-zinc-900/80 text-zinc-500',
              )}
            >
              {n}
            </div>
            {idx < 3 ? (
              <div className="flex w-7 items-center sm:w-12">
                <div
                  className={cn(
                    'h-0.5 flex-1 rounded-full transition-colors duration-300',
                    step > n ? 'bg-sky-500' : 'bg-zinc-700',
                  )}
                />
                <ChevronRight
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors duration-300',
                    step > n ? 'text-sky-400' : 'text-zinc-600',
                  )}
                  strokeWidth={2.5}
                  aria-hidden
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  const [showSlowHint, setShowSlowHint] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShowSlowHint(true), 6000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
      {showSlowHint ? (
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
          Mag7 snapshot is built from Zarr. The first request in local dev often
          takes 30–60s while data warms up; the page is still working.
        </p>
      ) : null}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 px-2 text-center text-sm text-amber-200">
      <AlertCircle className="h-5 w-5 shrink-0" />
      {message}
    </div>
  );
}
