import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const SURFACES = [
  {
    title: 'PNG / Plotly export',
    detail:
      'Python client.visuals.save_*_png helpers — publication DPI and themed Plotly layout (Kaleido).',
  },
  {
    title: 'React primitives',
    detail:
      'npm @riskmodels/web — peel lines, yearly attribution, four-bet card; same ERM3 semantics as the SDK.',
  },
  {
    title: 'Hedge notionals',
    detail: 'Per-$1 ETF ratios from the same decomposition object.',
  },
  {
    title: 'Structured JSON',
    detail: 'API bodies carry _metadata — stable for agents and CI pipelines.',
  },
  {
    title: 'ERM3 snapshots',
    detail: 'PDF one-pagers from the same underlying metrics.',
  },
] as const;

/**
 * Surfaces one response fans out to: viz export, UI kit, execution, automation.
 */
export default function OneCallManySurfaces() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl">
            One response. Multiple surfaces.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Same SDK call (or REST shape) drives exports, embeddable charts, and downstream systems —
            not toy demos with divergent schemas.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,240px)_1fr] lg:gap-10">
          <div className="rounded-xl border border-zinc-800 bg-black/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Contract</p>
            <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-300">
              {`POST /decompose
{
  "ticker": "NVDA"
}`}
            </pre>
            <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
              Or{' '}
              <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400">GET /metrics/NVDA</code> for
              scalar block + lineage. Python wraps both on{' '}
              <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400">RiskModelsClient</code>.
            </p>
            <Link
              href="/api-reference"
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              API reference <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((s) => (
              <div
                key={s.title}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700"
              >
                <h3 className="text-sm font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
