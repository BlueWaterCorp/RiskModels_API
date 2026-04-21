const LAYERS = [
  {
    name: 'Market',
    etf: 'SPY',
    desc: 'Broad equity beta',
    color: 'from-blue-600/30 to-blue-800/30 border-blue-500/40',
    pill: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  },
  {
    name: 'Sector',
    etf: 'XLK / XLF / XLE ...',
    desc: 'GICS sector exposure',
    color: 'from-teal-600/30 to-teal-800/30 border-teal-500/40',
    pill: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  },
  {
    name: 'Subsector',
    etf: 'SMH / KBE / OIH ...',
    desc: 'Industry group exposure',
    color: 'from-cyan-600/30 to-cyan-800/30 border-cyan-500/40',
    pill: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  {
    name: 'Residual',
    etf: '(stock-specific)',
    desc: 'Idiosyncratic / alpha',
    color: 'from-emerald-600/30 to-emerald-800/30 border-emerald-500/40',
    pill: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
];

export default function CoreInsightFourBets() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl">
            One position ={' '}
            <span className="text-primary">four bets.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Every position is a combination of market, sector, subsector, and
            idiosyncratic risk. RiskModels makes each layer explicit &mdash; and
            tradable.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LAYERS.map((l) => (
            <div
              key={l.name}
              className={`rounded-2xl border bg-gradient-to-br ${l.color} p-5`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{l.name}</h3>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-xs ${l.pill}`}
                >
                  {l.etf}
                </span>
              </div>
              <p className="mt-3 text-sm text-zinc-300">{l.desc}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center font-mono text-xs text-zinc-500 sm:text-sm">
          market_er + sector_er + subsector_er + residual_er &asymp; 1
        </p>
      </div>
    </section>
  );
}
