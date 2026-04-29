'use client';

/**
 * Two-panel hero: invocation (Python / CLI / agent) + one-call output system
 * driven by the same landing preview payloads as the Mag7 walkthrough.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  Erm3FourBetCard,
  Erm3HedgeMap,
  Erm3WalkthroughLineChart,
  formatHedgeSummary,
  type FourBetExposure,
  type FourLayerKey,
  type WalkthroughSnapshot,
} from '@riskmodels/web';
import { cn } from '@/lib/cn';
import {
  getLandingPreview,
  LANDING_PREVIEW_TICKER,
  type LandingDecomposePreview,
} from '@/components/landing/landing-preview';

const STEP_MS = 2800;

const PYTHON_SNIPPET = `from riskmodels import RiskModelsClient

decompose = RiskModelsClient.from_env().decompose
decompose("${LANDING_PREVIEW_TICKER}")`;

const CLI_SNIPPET = `riskmodels decompose ${LANDING_PREVIEW_TICKER}`;

const AGENT_PROMPT = `Why did ${LANDING_PREVIEW_TICKER} move last month?`;

type InvokeTab = 'python' | 'cli' | 'agent';

function buildNarrative(exposure: FourBetExposure | null): string {
  if (!exposure) {
    return 'Load decomposition to see variance share by layer and mapped hedge ETFs.';
  }
  const layers: { key: FourLayerKey; label: string }[] = [
    { key: 'market', label: 'broad market' },
    { key: 'sector', label: 'sector' },
    { key: 'subsector', label: 'subsector' },
    { key: 'residual', label: 'residual (idiosyncratic)' },
  ];
  let best = layers[0];
  let bestEr = -1;
  for (const { key, label } of layers) {
    const er = exposure[key].er ?? 0;
    if (er > bestEr) {
      bestEr = er;
      best = { key, label };
    }
  }
  const etf = exposure[best.key].hedge_etf;
  const pct = Math.round((exposure[best.key].er ?? 0) * 100);
  const etfBit = etf && best.key !== 'residual' ? ` — mapped to ${etf}.` : '.';
  return `${pct}% of explained variance loads on ${best.label}${etfBit}`;
}

function compactJsonSnippet(body: LandingDecomposePreview | null): string {
  if (!body) return '{ "ticker": "NVDA", ... }';
  const slim = {
    ticker: body.ticker,
    data_as_of: body.data_as_of,
    exposure: body.exposure,
    hedge: body.hedge,
  };
  const s = JSON.stringify(slim, null, 2);
  const lines = s.split('\n');
  if (lines.length > 14) {
    return lines.slice(0, 12).join('\n') + '\n  …\n}';
  }
  return s;
}

const OUTPUT_STEPS = [
  { id: 1, label: 'L3 decomposition' },
  { id: 2, label: 'Hedge ratios' },
  { id: 3, label: 'JSON' },
  { id: 4, label: 'Narrative' },
] as const;

export default function HeroDecompose() {
  const [tab, setTab] = useState<InvokeTab>('python');
  const [body, setBody] = useState<LandingDecomposePreview | null>(null);
  const [snapshot, setSnapshot] = useState<WalkthroughSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getLandingPreview()
      .then((preview) => {
        if (cancelled) return;
        setBody(preview.decompose);
        setSnapshot(preview.snapshot);
      })
      .catch((e) => {
        if (cancelled) return;
        setBody(null);
        setSnapshot(null);
        setLoadError(e instanceof Error ? e.message : 'Failed to load preview');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s >= 4 ? 1 : s + 1));
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  const narrative = useMemo(() => buildNarrative(body?.exposure ?? null), [body?.exposure]);
  const hedgeSummary = useMemo(
    () => (body ? formatHedgeSummary(body.hedge, body.ticker) : ''),
    [body],
  );

  const invocationText =
    tab === 'python' ? PYTHON_SNIPPET : tab === 'cli' ? CLI_SNIPPET : AGENT_PROMPT;

  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-16">
      <div className="relative z-[2] mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Risk engine · agent-native
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            One call. Four layers. Tradable hedges.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            An API that decomposes any US equity or portfolio into four tradable risk layers (market,
            sector, subsector, residual), returning hedge ratios and full risk context in one call.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-white transition hover:bg-primary/90"
            >
              Quickstart <ArrowRight size={18} />
            </Link>
            <Link
              href="/get-key"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-600 bg-zinc-900 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-zinc-800"
            >
              Get an API key
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-2 lg:gap-8">
          {/* Left: invocation */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Invocation
            </p>
            <div className="mt-3 flex gap-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5">
              {(
                [
                  ['python', 'Python'],
                  ['cli', 'CLI'],
                  ['agent', 'Agent'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex-1 rounded-md py-2 text-xs font-semibold transition sm:text-sm',
                    tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <pre className="mt-4 max-h-[min(280px,40vh)] overflow-auto rounded-lg border border-zinc-800 bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-zinc-300 sm:text-xs">
              {invocationText}
            </pre>
            <p className="mt-3 text-[11px] text-zinc-500">
              Preview uses public Mag7 endpoints; full universe requires a key.
            </p>
          </div>

          {/* Right: output system */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {OUTPUT_STEPS.map((s) => (
                <span
                  key={s.id}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
                    step === s.id
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-zinc-800 text-zinc-500',
                  )}
                >
                  {s.label}
                </span>
              ))}
            </div>

            {loadError ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                {loadError}
              </div>
            ) : null}

            <div
              className={cn(
                'rounded-xl border bg-zinc-950 p-3 transition-colors sm:p-4',
                step === 1 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-zinc-800',
              )}
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                L3 decomposition + peel
              </p>
              {snapshot?.line?.length ? (
                <Erm3WalkthroughLineChart rows={snapshot.line} activeStep={step} height={200} />
              ) : (
                <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  Chart loading…
                </div>
              )}
              {body ? (
                <div className="mt-3">
                  <Erm3FourBetCard exposure={body.exposure} asOfLabel={body.data_as_of ?? null} />
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                'rounded-xl border bg-zinc-950 p-3 transition-colors sm:p-4',
                step === 2 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-zinc-800',
              )}
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Hedge ratios (per $1 long)
              </p>
              {body ? <Erm3HedgeMap hedge={body.hedge} /> : (
                <p className="text-sm text-zinc-500">—</p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div
                className={cn(
                  'rounded-xl border bg-zinc-950 p-3 transition-colors sm:p-4',
                  step === 3 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-zinc-800',
                )}
              >
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Response JSON
                </p>
                <pre className="max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-zinc-400">
                  {compactJsonSnippet(body)}
                </pre>
              </div>
              <div
                className={cn(
                  'rounded-xl border bg-zinc-950 p-3 transition-colors sm:p-4',
                  step === 4 ? 'border-primary/40 ring-1 ring-primary/20' : 'border-zinc-800',
                )}
              >
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Operator readout
                </p>
                <p className="text-sm leading-relaxed text-zinc-200">{narrative}</p>
                {body && hedgeSummary ? (
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">{hedgeSummary}</p>
                ) : null}
              </div>
            </div>

            <p className="text-center text-[10px] text-zinc-600">
              All visuals above are driven from the same API response shape the Python SDK consumes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
