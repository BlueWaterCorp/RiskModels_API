import { ATTRIBUTION_CLASSES } from '@/lib/landing/attributionColors';

const ROWS = [
  { layer: 'Market',    etf: 'SPY', role: 'macro exposure',    color: ATTRIBUTION_CLASSES.market,    emphasis: false },
  { layer: 'Sector',    etf: 'XLK', role: 'tech exposure',     color: ATTRIBUTION_CLASSES.sector,    emphasis: false },
  { layer: 'Subsector', etf: 'SMH', role: 'semiconductor bet', color: ATTRIBUTION_CLASSES.subsector, emphasis: false },
  { layer: 'Residual',  etf: '—',   role: 'company-specific',  color: ATTRIBUTION_CLASSES.residual,  emphasis: true  },
];

export default function OnePositionFourBets() {
  return (
    <section className="border-b border-zinc-800/80 bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            One position
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            NVDA = four bets
          </h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40">
          <table className="w-full text-left">
            <thead className="bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3">Layer</th>
                <th className="px-5 py-3">ETF</th>
                <th className="px-5 py-3">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {ROWS.map((row) => (
                <tr
                  key={row.layer}
                  className={row.emphasis ? 'bg-emerald-500/[0.04]' : ''}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${row.color}`}
                      />
                      <span
                        className={
                          row.emphasis
                            ? 'font-semibold text-white'
                            : 'text-zinc-300'
                        }
                      >
                        {row.layer}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.etf}</td>
                  <td className="px-5 py-4 text-zinc-400">{row.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-center text-base text-zinc-300 sm:text-lg">
          Only the residual is{' '}
          <span className="font-semibold text-emerald-400">what you actually own</span>.
        </p>
      </div>
    </section>
  );
}
