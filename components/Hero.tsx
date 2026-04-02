import Link from 'next/link';
import { Zap } from 'lucide-react';
import { HeroGetStartedPulse } from '@/components/HeroGetStartedPulse';
import TrustTechBar from '@/components/TrustTechBar';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-zinc-950 px-4 pb-3 pt-14 sm:px-6 sm:pb-3.5 sm:pt-16 lg:px-8 lg:pb-4">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950/25" />

      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      {/* Fade into workbench band */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-20 bg-gradient-to-t from-zinc-950 via-zinc-950/88 to-transparent sm:h-24"
        aria-hidden
      />

      <div className="relative z-[2] mx-auto max-w-5xl space-y-3 text-center sm:space-y-4">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
          <Zap size={16} />
          Baseline &amp; Premium · First Agentic Risk API · MCP-ready
        </div>

        {/* Headline */}
        <h1 className="text-4xl font-bold tracking-tighter text-white sm:text-5xl md:text-6xl lg:text-7xl">
          An Agentic Approach to Managing{' '}
          <span className="text-primary">Equity Risk.</span>
        </h1>

        <p className="mx-auto max-w-3xl text-sm font-semibold uppercase tracking-widest text-blue-400">
          Baseline vs Premium
        </p>
        <p className="mx-auto max-w-3xl text-base font-medium leading-relaxed text-zinc-200 sm:text-lg md:text-xl">
          Baseline features ($0.001–$0.005/call) power everyday risk checks and time series. Premium
          capabilities unlock deeper L3 decomposition, portfolio-level risk indexing, PDF snapshots,
          and batch analytics — perfect for agents and power users.
        </p>

        <p className="mx-auto max-w-3xl text-sm leading-relaxed text-zinc-500 sm:text-base">
          From market, sector, and subsector attribution to automated hedging logic — calibrate your
          whole stack through one institutional-grade API.
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center justify-center gap-3 pt-0.5 sm:flex-row sm:gap-4 sm:pt-1">
          <HeroGetStartedPulse />
          <Link
            href="/docs/api"
            className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white transition-colors rounded-lg border border-slate-600/80 bg-[#1e293b] hover:bg-[#334155]"
          >
            Read the Docs
          </Link>
        </div>

        {/* Pricing summary — directly under CTAs */}
        <p className="mx-auto max-w-xl pt-1 text-sm leading-relaxed text-zinc-500">
          $0 upfront · $20 free credits · Pay per tiered call · No subscription · No seat fees
        </p>

        <TrustTechBar />
      </div>
    </section>
  );
}
