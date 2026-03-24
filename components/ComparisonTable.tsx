import { Check, X, Zap } from 'lucide-react';
import Link from 'next/link';

const features = [
  { label: 'Multi-factor risk models', barra: true, northfield: true, riskmodels: true },
  { label: 'Equity factor coverage', barra: true, northfield: true, riskmodels: '16,495 tickers' },
  { label: 'Agentic task delegation', barra: false, northfield: false, riskmodels: true, highlight: true },
  { label: 'API-first access', barra: false, northfield: false, riskmodels: true },
  { label: 'Same-day provisioning', barra: false, northfield: false, riskmodels: true },
  { label: 'Open-source methodology', barra: false, northfield: false, riskmodels: true },
  { label: 'Real-time / intraday', barra: false, northfield: false, riskmodels: true },
  { label: 'Usage-based pricing', barra: false, northfield: false, riskmodels: true },
];

export default function ComparisonTable() {
  return (
    <section className="w-full py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950 border-y border-zinc-800">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            Enterprise Analytics.
            <span className="text-zinc-400"> Not Enterprise Pricing.</span>
          </h2>
          <p className="text-lg text-zinc-400">
            The methodology is the same. The contract length is not.
          </p>
        </div>

        {/* Comparison Table */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 overflow-hidden mb-8">
          {/* Table Header */}
          <div className="grid grid-cols-4 border-b border-zinc-800">
            <div className="p-4 sm:p-5 border-r border-zinc-800 bg-zinc-900/40">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Feature</span>
            </div>
            <div className="p-4 sm:p-5 border-r border-zinc-800 text-center">
              <h3 className="text-sm font-semibold text-zinc-300">MSCI Barra</h3>
              <p className="text-xs text-zinc-500 mt-1">$500K+/yr</p>
            </div>
            <div className="p-4 sm:p-5 border-r border-zinc-800 text-center">
              <h3 className="text-sm font-semibold text-zinc-300">Northfield</h3>
              <p className="text-xs text-zinc-500 mt-1">$200K+/yr</p>
            </div>
            <div className="p-4 sm:p-5 text-center bg-primary/5">
              <h3 className="text-sm font-semibold text-primary">RiskModels</h3>
              <p className="text-xs text-primary/70 mt-1">$10K–$25K/yr</p>
            </div>
          </div>

          {/* Table Body */}
          {features.map((feature, idx) => (
            <div
              key={feature.label}
              className={`grid grid-cols-4 ${idx !== features.length - 1 ? 'border-b border-zinc-800' : ''}`}
            >
              <div className="p-3 sm:p-4 border-r border-zinc-800 flex items-center">
                <span className={`text-sm ${feature.highlight ? 'text-white font-medium' : 'text-zinc-400'}`}>
                  {feature.label}
                </span>
              </div>

              {/* Barra */}
              <div className="p-3 sm:p-4 border-r border-zinc-800 flex items-center justify-center">
                {feature.barra === true ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Check size={12} className="text-emerald-400" />
                  </div>
                ) : feature.barra === false ? (
                  <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center">
                    <X size={12} className="text-zinc-500" />
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500">{feature.barra}</span>
                )}
              </div>

              {/* Northfield */}
              <div className="p-3 sm:p-4 border-r border-zinc-800 flex items-center justify-center">
                {feature.northfield === true ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Check size={12} className="text-emerald-400" />
                  </div>
                ) : feature.northfield === false ? (
                  <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center">
                    <X size={12} className="text-zinc-500" />
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500">{feature.northfield}</span>
                )}
              </div>

              {/* RiskModels */}
              <div className="p-3 sm:p-4 flex items-center justify-center bg-primary/5">
                {feature.riskmodels === true ? (
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${feature.highlight ? 'bg-primary/20' : 'bg-emerald-500/10'}`}>
                    <Check size={12} className={feature.highlight ? 'text-primary' : 'text-emerald-400'} />
                  </div>
                ) : typeof feature.riskmodels === 'string' ? (
                  <span className={`text-xs ${feature.highlight ? 'text-primary font-medium' : 'text-emerald-400'}`}>
                    {feature.riskmodels}
                  </span>
                ) : null}
              </div>
            </div>
          ))}

          {/* Table Footer / CTA Row */}
          <div className="grid grid-cols-4 border-t border-zinc-800">
            <div className="p-4 border-r border-zinc-800 bg-zinc-900/40">
              <span className="text-xs text-zinc-500">Availability</span>
            </div>
            <div className="p-4 border-r border-zinc-800 text-center">
              <span className="text-xs text-zinc-500">Negotiated only</span>
            </div>
            <div className="p-4 border-r border-zinc-800 text-center">
              <span className="text-xs text-zinc-500">Enterprise only</span>
            </div>
            <div className="p-4 text-center bg-primary/5">
              <Link
                href="/get-key"
                className="inline-flex items-center gap-1 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-lg transition-all"
              >
                Get API Key
                <Zap size={14} />
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom Note */}
        <div className="text-center">
          <p className="text-zinc-500 text-sm mb-3">
            RiskModels is built for teams that want institutional-grade risk analytics
            without the 6-month sales cycle.
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
