import { ArrowRight } from 'lucide-react';

/** Illustrative values; live numbers come from the MAG7 decompose widget above. */
const ROWS = [
  {
    ticker: 'AAPL',
    market: 0.51,
    sector: 0.02,
    subsector: 0.0,
    residual: 0.47,
    story: 'Mostly market + residual',
    tint: 'border-blue-500/40 bg-blue-500/5',
  },
  {
    ticker: 'NVDA',
    market: 0.45,
    sector: 0.22,
    subsector: 0.2,
    residual: 0.13,
    story: 'Heavy sector + subsector bet',
    tint: 'border-cyan-500/40 bg-cyan-500/5',
  },
];

function Bar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.max(2, Math.round(value * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-300">{value.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function NvdaVsAaplHook() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl">
            Same sector label.{' '}
            <span className="text-primary">Completely different trades.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Two investors both want &ldquo;more tech.&rdquo; One buys AAPL, the
            other buys NVDA. They did not buy the same thing.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {ROWS.map((r) => (
            <div
              key={r.ticker}
              className={`rounded-2xl border ${r.tint} p-6`}
            >
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-2xl font-bold text-white">{r.ticker}</h3>
                <span className="text-xs font-semibold text-zinc-400">
                  Explained risk by layer
                </span>
              </div>
              <div className="space-y-3">
                <Bar label="Market" value={r.market} color="bg-blue-500" />
                <Bar label="Sector" value={r.sector} color="bg-teal-500" />
                <Bar label="Subsector" value={r.subsector} color="bg-cyan-500" />
                <Bar label="Residual" value={r.residual} color="bg-emerald-500" />
              </div>
              <p className="mt-5 text-sm font-semibold text-white">
                {r.story}
              </p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 flex max-w-3xl items-center justify-center gap-2 text-center text-sm text-zinc-300 sm:text-base">
          The API shows the difference instantly.{' '}
          <ArrowRight size={16} className="text-primary" />
        </p>
      </div>
    </section>
  );
}
