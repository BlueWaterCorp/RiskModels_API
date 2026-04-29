'use client';

/**
 * SDK-first hero: copyable Python + TypeScript snippets drive publication-style
 * visuals from the same landing preview payloads as the walkthrough.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import {
  Erm3FourBetCard,
  Erm3HedgeMap,
  Erm3WalkthroughLineChart,
  Erm3YearlyAttributionBars,
  type WalkthroughSnapshot,
} from '@riskmodels/web';
import CodeBlock from '@/components/CodeBlock';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import {
  getLandingPreview,
  LANDING_PREVIEW_TICKER,
  type LandingDecomposePreview,
} from '@/components/landing/landing-preview';

const LANDING_TICKER_LC = LANDING_PREVIEW_TICKER.toLowerCase();

const PYTHON_HERO = `from riskmodels import RiskModelsClient

client = RiskModelsClient.from_env()
client.decompose("${LANDING_PREVIEW_TICKER}")  # dict + layered ER/HR + hedge map
client.visuals.save_l3_decomposition_png(
    ticker="${LANDING_PREVIEW_TICKER}",
    filename="${LANDING_TICKER_LC}_l3.png",
)`;

const TS_HERO = `import {
  fetchRiskmodelsMetrics,
  mapMetricsToFourBet,
  buildHedgeMapFromFourBet,
} from "@riskmodels/web";

const base = "https://riskmodels.app";
const res = await fetchRiskmodelsMetrics(base, "${LANDING_PREVIEW_TICKER}", {
  headers: { Authorization: \`Bearer \${process.env.RISKMODELS_API_KEY}\` },
});
const body = await res.json();
const exposure = mapMetricsToFourBet(body.metrics, body.meta ?? {});
const hedge = buildHedgeMapFromFourBet(exposure);`;

type VisualTab = 'profile' | 'peel' | 'year' | 'lineage';
type MobilePanel = 'code' | 'visual';

const VISUAL_TABS: { id: VisualTab; label: string }[] = [
  { id: 'profile', label: 'Risk profile' },
  { id: 'peel', label: 'Peel' },
  { id: 'year', label: 'Year attribution' },
  { id: 'lineage', label: 'Lineage' },
];

export default function HeroDecompose() {
  const [body, setBody] = useState<LandingDecomposePreview | null>(null);
  const [snapshot, setSnapshot] = useState<WalkthroughSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visualTab, setVisualTab] = useState<VisualTab>('profile');
  const [peelStep, setPeelStep] = useState(4);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('code');
  const [snippetCopied, setSnippetCopied] = useState(false);

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

  const copySnippet = useCallback(() => {
    void copyTextToClipboard(PYTHON_HERO).then((ok) => {
      if (ok) {
        setSnippetCopied(true);
        window.setTimeout(() => setSnippetCopied(false), 2000);
      }
    });
  }, []);

  const lineageRows = useMemo(() => {
    const rows: { k: string; v: string }[] = [];
    rows.push({ k: 'Ticker', v: body?.ticker ?? snapshot?.ticker ?? LANDING_PREVIEW_TICKER });
    if (body?.data_as_of) rows.push({ k: 'data_as_of', v: body.data_as_of });
    if (snapshot?.asOf) rows.push({ k: 'snapshot asOf', v: snapshot.asOf });
    if (snapshot?.sectorEtf) rows.push({ k: 'Sector ETF', v: snapshot.sectorEtf });
    if (snapshot?.subsectorEtf) rows.push({ k: 'Subsector ETF', v: snapshot.subsectorEtf });
    rows.push({
      k: 'Python metadata',
      v: 'decompose(...) response includes _metadata; DataFrame path sets df.attrs (legend, riskmodels_lineage, cheatsheet).',
    });
    return rows;
  }, [body, snapshot]);

  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-none lg:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            RiskModels SDK · ERM3 visuals
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            One SDK call. Publication-ready risk visuals.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg lg:mx-0">
            Decompose any US equity or portfolio into market, sector, subsector, and residual risk. Return
            hedge ratios, chart-ready data, and lineage metadata from the same call.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
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

        {/* Mobile: Code | Visual */}
        <div className="mt-8 flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5 lg:hidden">
          {(
            [
              ['code', 'Code'],
              ['visual', 'Visual'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMobilePanel(id)}
              className={cn(
                'flex-1 rounded-md py-2.5 text-xs font-semibold transition',
                mobilePanel === id ? 'bg-zinc-800 text-white' : 'text-zinc-500',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-8 lg:mt-12 lg:grid-cols-12 lg:gap-10">
          {/* Left: snippets */}
          <div
            className={cn(
              'space-y-5 lg:col-span-5',
              mobilePanel === 'visual' ? 'hidden lg:block' : '',
            )}
          >
            <CodeBlock code={PYTHON_HERO} language="python" filename="python" />
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                TypeScript / @riskmodels/web
              </p>
              <CodeBlock code={TS_HERO} language="typescript" filename="metrics.ts" />
            </div>
          </div>

          {/* Right: visual artifact */}
          <div
            className={cn('lg:col-span-7', mobilePanel === 'code' ? 'hidden lg:block' : '')}
          >
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2.5 sm:px-4">
                <div className="flex flex-wrap gap-1">
                  {VISUAL_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setVisualTab(t.id)}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition sm:text-xs',
                        visualTab === t.id
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-500 hover:text-zinc-300',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={copySnippet}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  {snippetCopied ? (
                    <>
                      <Check size={14} className="text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy SDK snippet
                    </>
                  )}
                </button>
              </div>

              {loadError ? (
                <div className="m-3 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-sm text-amber-100">
                  {loadError}
                </div>
              ) : null}

              <div className="p-3 sm:p-4">
                {visualTab === 'profile' && body ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Erm3FourBetCard exposure={body.exposure} asOfLabel={body.data_as_of ?? null} />
                    <Erm3HedgeMap hedge={body.hedge} />
                  </div>
                ) : null}

                {visualTab === 'profile' && !body && !loadError ? (
                  <div className="flex min-h-[280px] items-center justify-center text-sm text-zinc-500">
                    Loading…
                  </div>
                ) : null}

                {visualTab === 'peel' ? (
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        Peel step
                      </span>
                      {[1, 2, 3, 4].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPeelStep(s)}
                          className={cn(
                            'h-8 w-8 rounded-md text-xs font-bold',
                            peelStep === s
                              ? 'bg-primary text-white'
                              : 'border border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-600',
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    {snapshot?.line?.length ? (
                      <Erm3WalkthroughLineChart rows={snapshot.line} activeStep={peelStep} height={320} />
                    ) : (
                      <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                        Chart loading…
                      </div>
                    )}
                  </div>
                ) : null}

                {visualTab === 'year' ? (
                  snapshot?.bars?.length ? (
                    <div className="h-[320px] w-full max-w-full">
                      <Erm3YearlyAttributionBars
                        bars={snapshot.bars}
                        visibleThrough={4}
                        sectorEtf={snapshot.sectorEtf}
                        subsectorEtf={snapshot.subsectorEtf}
                        hatchIdPrefix="heroYear"
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
                      Attribution bars loading…
                    </div>
                  )
                ) : null}

                {visualTab === 'lineage' ? (
                  <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      Reproducibility
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                      {lineageRows.map((r) => (
                        <li key={r.k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                          <span className="shrink-0 font-mono text-xs text-zinc-500">{r.k}</span>
                          <span className="font-mono text-xs text-zinc-200">{r.v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500 lg:text-left">
              One import. One call. This exact visual — reproducible, themed, with full lineage metadata.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
