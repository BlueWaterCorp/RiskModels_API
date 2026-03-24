import { ArrowRight, Check, X } from 'lucide-react';
import Link from 'next/link';

const features = [
  { label: 'Multi-factor risk models', barra: true, northfield: true, riskmodels: true },
  { label: 'Equity factor coverage', barra: true, northfield: true, riskmodels: '16,495 tickers' },
  { label: 'Agentic task delegation', barra: false, northfield: false, riskmodels: true, highlight: true },
  { label: 'API-first access', barra: false, northfield: false, riskmodels: true },
  { label: 'Same-day provisioning', barra: false, northfield: false, riskmodels: true },
  { label: 'Open-source methodology', barra: false, northfield: false, riskmodels: true },
  { label: 'Real-time / intraday', barra: false, northfield: false, riskmodels: 'Coming soon' },
  { label: 'Usage-based pricing', barra: false, northfield: false, riskmodels: true },
];

export default function ComparisonTable() {
  return (
    <section className="relative w-full bg-transparent px-4 pt-16 pb-10 sm:px-6 sm:pb-11 lg:px-8 lg:pb-12">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/35 to-transparent"
        aria-hidden
      />
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 text-center lg:mb-7">
          <h2 className="mb-2 text-3xl font-bold tracking-tighter text-white sm:text-4xl">
            Enterprise Analytics.
            <span className="text-zinc-500"> Not Enterprise Pricing.</span>
          </h2>
          <p className="text-lg text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            The methodology is the same. The contract length is not.
          </p>
        </div>

        {/* Minimal table — no heavy grid borders; scroll on narrow screens */}
        <div className="rounded-2xl overflow-hidden bg-zinc-950/40 -mx-1 sm:mx-0">
          <div className="overflow-x-auto overscroll-x-contain">
            <div className="min-w-[640px] md:min-w-0">
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1fr)] gap-0">
            {/* Header row */}
            <div className="px-4 sm:px-5 py-4 flex items-end">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">Feature</span>
            </div>
            <div className="px-3 sm:px-4 py-4 text-center flex flex-col justify-end">
              <h3 className="text-xs sm:text-sm font-semibold text-zinc-400 tracking-tight">MSCI Barra</h3>
              <p className="text-[11px] text-zinc-600 mt-1">$500K+/yr</p>
            </div>
            <div className="px-3 sm:px-4 py-4 text-center flex flex-col justify-end">
              <h3 className="text-xs sm:text-sm font-semibold text-zinc-400 tracking-tight">Northfield</h3>
              <p className="text-[11px] text-zinc-600 mt-1">$200K+/yr</p>
            </div>
            <div className="px-3 sm:px-5 py-4 text-center flex flex-col justify-end relative z-[1] md:scale-[1.04] md:origin-top shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_12px_40px_-20px_rgba(59,130,246,0.25)] rounded-t-xl bg-gradient-to-b from-primary/[0.12] to-zinc-950/80 border border-primary/20 border-b-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/90 mb-1">Recommended</span>
              <h3 className="text-sm sm:text-base font-semibold text-primary tracking-tight">RiskModels</h3>
              <p className="text-[11px] text-primary/75 mt-1">$10K–$25K/yr</p>
            </div>
              </div>

              <div className="divide-y divide-zinc-800/50">
            {features.map((feature) => (
              <div
                key={feature.label}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1fr)] gap-0 group/row transition-colors hover:bg-zinc-800/25"
              >
                <div className="px-4 sm:px-5 py-3.5 sm:py-4 flex items-center">
                  <span
                    className={`text-sm leading-snug ${feature.highlight ? 'text-white font-medium' : 'text-zinc-400'}`}
                  >
                    {feature.label}
                  </span>
                </div>

                <div className="px-3 sm:px-4 py-3.5 sm:py-4 flex items-center justify-center">
                  {feature.barra === true ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Check size={12} className="text-emerald-400/90" />
                    </div>
                  ) : feature.barra === false ? (
                    <div className="w-5 h-5 rounded-full bg-zinc-800/80 flex items-center justify-center">
                      <X size={12} className="text-zinc-600" />
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-500">{feature.barra}</span>
                  )}
                </div>

                <div className="px-3 sm:px-4 py-3.5 sm:py-4 flex items-center justify-center">
                  {feature.northfield === true ? (
                    <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Check size={12} className="text-emerald-400/90" />
                    </div>
                  ) : feature.northfield === false ? (
                    <div className="w-5 h-5 rounded-full bg-zinc-800/80 flex items-center justify-center">
                      <X size={12} className="text-zinc-600" />
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-500">{feature.northfield}</span>
                  )}
                </div>

                <div className="px-3 sm:px-5 py-3.5 sm:py-4 flex items-center justify-center md:scale-[1.04] md:origin-top bg-primary/[0.04] group-hover/row:bg-primary/[0.08] border-l border-primary/10 transition-colors">
                  {feature.riskmodels === true ? (
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${
                        feature.highlight ? 'bg-primary/25' : 'bg-emerald-500/10'
                      }`}
                    >
                      <Check size={12} className={feature.highlight ? 'text-primary' : 'text-emerald-400'} />
                    </div>
                  ) : typeof feature.riskmodels === 'string' ? (
                    <span
                      className={`text-xs text-center ${feature.highlight ? 'text-primary font-medium' : 'text-emerald-400'}`}
                    >
                      {feature.riskmodels}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
              </div>

              {/* Footer row */}
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1fr)] gap-0 border-t border-zinc-800/50 mt-0">
                <div className="px-4 sm:px-5 py-4 flex items-center">
                  <span className="text-xs text-zinc-500">Availability</span>
                </div>
                <div className="px-3 sm:px-4 py-4 text-center flex items-center justify-center">
                  <span className="text-xs text-zinc-500">Negotiated only</span>
                </div>
                <div className="px-3 sm:px-4 py-4 text-center flex items-center justify-center">
                  <span className="text-xs text-zinc-500">Enterprise only</span>
                </div>
                <div className="px-3 sm:px-5 py-4 text-center flex items-center justify-center md:scale-[1.04] md:origin-bottom bg-gradient-to-t from-primary/[0.1] to-transparent rounded-b-xl border border-t-0 border-primary/15">
                  <Link
                    href="/get-key"
                    className="group inline-flex items-center gap-2 px-8 py-4 bg-primary hover:bg-primary/90 text-white text-lg font-semibold rounded-lg transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30"
                  >
                    Get Started
                    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="mx-auto mb-2 max-w-xl text-sm leading-relaxed text-zinc-500">
            RiskModels is built for teams that want institutional-grade risk analytics without the 6-month
            sales cycle.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium text-sm transition-colors"
          >
            Full pricing details →
          </Link>
        </div>
      </div>
    </section>
  );
}
