import Link from 'next/link';
import { Zap, ArrowLeftRight, Scale, Activity, RefreshCw, Shield } from 'lucide-react';

const accentClass = {
  emerald: {
    iconWrap: 'bg-emerald-500/10 border-emerald-500/20',
    icon: 'text-emerald-400',
    subtitle: 'text-emerald-400/75',
  },
  amber: {
    iconWrap: 'bg-amber-500/10 border-amber-500/20',
    icon: 'text-amber-400',
    subtitle: 'text-amber-400/75',
  },
  blue: {
    iconWrap: 'bg-blue-500/10 border-blue-500/20',
    icon: 'text-blue-400',
    subtitle: 'text-blue-400/75',
  },
  purple: {
    iconWrap: 'bg-purple-500/10 border-purple-500/20',
    icon: 'text-purple-400',
    subtitle: 'text-purple-400/75',
  },
} as const;

/** Hedge first (anchor); remaining three are implementation patterns. */
const patterns = [
  {
    id: 'hedge',
    icon: ArrowLeftRight,
    title: 'Hedge Recommendations',
    subtitle: 'Core capability',
    description:
      'L1/L2/L3 hedge ratios, sector/subsector ETFs, and explained risk — ready to map to notionals without rebuilding the model.',
    docsHref: '/docs/methodology',
    color: 'blue' as const,
    core: true,
  },
  {
    id: 'pretrade',
    icon: Shield,
    title: 'Pre-Trade Risk',
    subtitle: 'Implementation pattern',
    description:
      'Provide the data layer for automated factor-impact guardrails — marginal hedge-ratio and explained-risk deltas (market, sector, subsector) your rules engine evaluates before execution.',
    docsHref: '/docs/api',
    color: 'emerald' as const,
  },
  {
    id: 'drift',
    icon: Activity,
    title: 'Drift Monitoring',
    subtitle: 'Implementation pattern',
    description:
      'Calculate sigma-band drift against targets from L1/L2/L3 snapshot fields (`GET /metrics`) and L3 return history (`GET /ticker-returns`) — feed results into your monitoring stack or custom alert logic.',
    docsHref: '/docs/api',
    color: 'amber' as const,
  },
  {
    id: 'rebalance',
    icon: RefreshCw,
    title: 'Rebalance Triggers',
    subtitle: 'Agentic pattern',
    description:
      'Detect when factor tilts breach policy using decomposition and exposure series — the API surfaces calculated trade directions implied by the structure; you own rebalance timing.',
    docsHref: '/docs/agent-integration',
    color: 'purple' as const,
  },
] as const;

export default function UseCases() {
  return (
    <section
      id="what-you-can-do"
      className="relative z-[1] -mt-16 scroll-mt-20 w-full bg-transparent px-4 pt-6 pb-16 sm:px-6 sm:pt-7 sm:pb-16 lg:px-8 lg:pb-20"
    >
      <div className="mx-auto max-w-4xl min-w-0 lg:max-w-5xl">
        <div className="mb-6 text-center lg:mb-7">
          <div className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-400 sm:text-sm">
            <Zap size={14} className="shrink-0 text-primary sm:h-4 sm:w-4" />
            Hedge ratios first — patterns you orchestrate
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-tighter text-white sm:text-3xl md:text-4xl">
            The Foundation for Risk Agents
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Hedge recommendations are our deepest, most turnkey surface. The rest is structured data you
            connect to guards, monitors, and autonomous workflows.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5">
          {patterns.map((pattern) => {
            const Icon = pattern.icon;
            const a = accentClass[pattern.color];
            const isCore = 'core' in pattern && pattern.core;

            return (
              <div
                key={pattern.id}
                className={`group relative flex min-w-0 flex-col rounded-lg border bg-zinc-900/25 p-3.5 transition-colors sm:p-4 ${
                  isCore
                    ? 'border-blue-500/40 ring-1 ring-blue-500/15 bg-blue-500/[0.06] hover:border-blue-500/50 hover:bg-blue-500/[0.09]'
                    : 'border-zinc-800/90 hover:border-zinc-600/80 hover:bg-zinc-900/40'
                }`}
              >
                <div
                  className={`mb-2 flex min-w-0 items-start justify-between gap-2 ${isCore ? 'pr-[5.5rem] sm:pr-28' : ''}`}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${a.iconWrap}`}
                    >
                      <Icon className={a.icon} size={18} />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h3 className="text-sm font-semibold leading-snug text-white sm:text-base">
                        {pattern.title}
                      </h3>
                      <p className={`mt-0.5 text-[11px] font-medium sm:text-xs ${a.subtitle}`}>
                        {pattern.subtitle}
                      </p>
                    </div>
                  </div>
                  {isCore && (
                    <span className="absolute right-2 top-2 shrink-0 rounded border border-blue-500/35 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-300 sm:right-2.5 sm:top-2.5 sm:text-[10px]">
                      CORE ENDPOINT
                    </span>
                  )}
                </div>

                <p className="mb-2.5 flex-1 text-[11px] leading-relaxed text-zinc-400 sm:text-xs">
                  {pattern.description}
                </p>

                <Link
                  href={pattern.docsHref}
                  className={`mt-auto inline-flex text-[11px] font-semibold sm:text-xs ${
                    isCore ? 'text-primary hover:text-primary/85' : 'text-zinc-400 hover:text-primary'
                  }`}
                >
                  View Pattern Docs →
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3.5 sm:mt-6 sm:p-4">
          <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Scale className="text-primary" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-white sm:text-base">Plugs into your stack</h4>
              <p className="text-[11px] leading-relaxed text-zinc-500 sm:text-xs">
                REST, batch, Parquet/CSV exports, and MCP — you wire JSON into OMS, Slack, or agents; we do
                not sit in your execution path.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
