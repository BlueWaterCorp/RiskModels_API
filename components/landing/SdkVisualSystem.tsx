'use client';

/**
 * SDK-aligned visuals: same shapes as `riskmodels` + `@riskmodels/web`, not decorative charts.
 */

import { useEffect, useState } from 'react';
import {
  Erm3FourBetCard,
  Erm3WalkthroughLineChart,
  Erm3YearlyAttributionBars,
  type WalkthroughSnapshot,
} from '@riskmodels/web';
import {
  getLandingPreview,
  type LandingDecomposePreview,
} from '@/components/landing/landing-preview';

export default function SdkVisualSystem() {
  const [body, setBody] = useState<LandingDecomposePreview | null>(null);
  const [snapshot, setSnapshot] = useState<WalkthroughSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
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
        setErr(e instanceof Error ? e.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
            Programmatic visuals
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Matplotlib/Plotly pipelines in the Python SDK and these React primitives share the same
            ERM3 semantics: L3 decomposition, risk peel, variance-style attribution.
          </p>
        </div>

        {err ? (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
            {err}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Risk cascade (peel)
            </p>
            {snapshot?.line?.length ? (
              <Erm3WalkthroughLineChart rows={snapshot.line} activeStep={4} height={260} />
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-zinc-500">
                Loading…
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Variance waterfall (year/stack)
            </p>
            {snapshot?.bars?.length ? (
              <div className="mt-2 h-[260px]">
                <Erm3YearlyAttributionBars
                  bars={snapshot.bars}
                  visibleThrough={4}
                  sectorEtf={snapshot.sectorEtf}
                  subsectorEtf={snapshot.subsectorEtf}
                  hatchIdPrefix="sdkviz"
                />
              </div>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-zinc-500">
                Loading…
              </div>
            )}
          </div>

          {body ? (
            <div className="lg:col-span-2">
              <Erm3FourBetCard
                exposure={body.exposure}
                asOfLabel={body.data_as_of ?? null}
                title="L3 decomposition (scalar)"
              />
            </div>
          ) : null}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-[11px] leading-relaxed text-zinc-500">
          All visuals are generated from API responses via the RiskModels SDK and{' '}
          <span className="font-mono text-zinc-400">@riskmodels/web</span>.
        </p>
      </div>
    </section>
  );
}
