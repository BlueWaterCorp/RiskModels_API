import { ATTRIBUTION_HEX } from '@/lib/landing/attributionColors';

const LAYERS = [
  {
    key: 'market',
    number: '01',
    label: 'Market',
    description: 'Broad benchmark risk',
  },
  {
    key: 'sector',
    number: '02',
    label: 'Sector',
    description: 'Incremental sector exposure',
  },
  {
    key: 'subsector',
    number: '03',
    label: 'Subsector',
    description: 'Granular industry tilt',
  },
  {
    key: 'residual',
    number: '04',
    label: 'Residual',
    description: 'Stock-specific risk left visible',
  },
] as const;

export default function RiskMapPhilosophy() {
  return (
    <section className="border-b border-zinc-800 bg-black px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-14">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            A risk map, not a factor zoo.
          </p>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            See that benchmark in four layers.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-zinc-300 sm:text-lg">
            A factor zoo adds labels. A risk map shows relationships: how a position&rsquo;s
            modeled risk divides, which exposures connect to ETF references, and what remains
            stock-specific.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
            RiskModels organizes every position across four layers. The three systematic
            layers include model-derived ETF hedge ratios. The same structure carries from
            measurement into research, testing, and trading workflows.
          </p>
          <p className="mt-5 border-l-2 border-emerald-500/60 pl-4 text-sm leading-relaxed text-zinc-300">
            The map makes the terrain legible. You decide what to keep, what to hedge, and
            what to test.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 sm:px-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              Benchmark &rarr; bet
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Risk hierarchy
            </p>
          </div>

          <ol className="grid grid-cols-2 sm:grid-cols-4" aria-label="Equity-risk hierarchy">
            {LAYERS.map((layer, index) => (
              <li
                key={layer.key}
                className={`min-h-36 border-t-4 p-4 sm:min-h-44 sm:p-5 ${
                  index === 0 || index === 2 ? 'border-l-0' : 'border-l border-l-zinc-800'
                } ${index === 2 ? 'sm:border-l sm:border-l-zinc-800' : ''}`}
                style={{ borderTopColor: ATTRIBUTION_HEX[layer.key].up }}
              >
                <span className="font-mono text-[10px] text-zinc-600">{layer.number}</span>
                <h3 className="mt-3 font-mono text-sm font-semibold text-white">{layer.label}</h3>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{layer.description}</p>
              </li>
            ))}
          </ol>

          <div className="border-t border-zinc-800 px-5 py-5 sm:px-6">
            <p className="font-mono text-sm font-semibold tracking-tight text-zinc-200">
              Four layers. ETF hedge ratios. One API call.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
