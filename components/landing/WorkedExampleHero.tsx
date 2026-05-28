import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';

// Snapshot from ERM3 API for MSFT on 2026-05-26.
// L*=L3 confirmed (lstar_level=3, recommended_hedge_level="L3").
// Numbers are frozen for PR 1; PR 2 will wire this to a live API pull.
const SNAPSHOT_DATE = '2026-05-26';

type Layer = {
  layer: 'L1' | 'L2' | 'L3';
  label: string;
  etf: string;
  hr: number;
  er: number;
  dominant?: boolean;
};

const LAYERS: Layer[] = [
  { layer: 'L1', label: 'market', etf: 'SPY', hr: 0.03, er: 20 },
  { layer: 'L2', label: 'tech sector', etf: 'XLK', hr: 0.05, er: 4 },
  { layer: 'L3', label: 'systems software', etf: 'IGV', hr: 0.62, er: 18, dominant: true },
];

const RESIDUAL_ER = 57;

export default function WorkedExampleHero() {
  return (
    <section
      id="worked-example"
      className="border-b border-zinc-800 bg-zinc-950 px-4 py-14 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            Worked example — MSFT
          </p>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Per $1 long MSFT, ERM3 returns three hedge ratios you can trade.
          </h2>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black/70 px-2 py-6 shadow-2xl shadow-black/30 sm:px-4 sm:py-8">
          <div className="grid grid-cols-1 divide-y divide-zinc-800 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {LAYERS.map((row) => (
              <div key={row.layer} className="px-5 py-4 sm:px-6 sm:py-2">
                <p
                  className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
                    row.dominant ? 'text-emerald-400' : 'text-zinc-500'
                  }`}
                >
                  {row.layer} · {row.label}
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold text-white sm:text-[1.75rem]">
                  <span className="text-zinc-500">short</span>{' '}
                  <span className="tabular-nums">${row.hr.toFixed(2)}</span>{' '}
                  <span className="text-emerald-400">{row.etf}</span>
                </p>
                <p
                  className={`mt-2 font-mono text-[11px] ${
                    row.dominant ? 'text-emerald-300/80' : 'text-zinc-500'
                  }`}
                >
                  +{row.er}% explained risk
                  {row.dominant ? ' · dominant' : ''}
                </p>
              </div>
            ))}
          </div>

          <div className="mx-5 mt-6 border-t border-zinc-800 pt-5 sm:mx-6">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
                  What&rsquo;s left — the bet
                </p>
                <p className="mt-1 text-sm leading-snug text-zinc-300">
                  MSFT&rsquo;s stock-specific return. Not hedgeable with ETFs.
                </p>
              </div>
              <p className="font-mono text-3xl font-semibold text-white tabular-nums sm:text-[2.25rem]">
                {RESIDUAL_ER}%{' '}
                <span className="text-sm font-normal text-zinc-500">residual</span>
              </p>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center font-mono text-[11px] text-zinc-500">
          Live decomposition from the ERM3 API · single call, no extrapolation · snapshot {SNAPSHOT_DATE}
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/installation"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Run on your portfolio <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="https://riskmodels.org/methodology?utm_source=riskmodels-app&utm_medium=worked-example&utm_campaign=cross-site"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
          >
            See the methodology <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
