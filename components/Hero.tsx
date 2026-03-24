import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative flex flex-col justify-center px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20 pb-2 sm:pb-3 overflow-hidden min-h-[min(62vh,720px)] sm:min-h-[min(58vh,680px)]">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950/25" />

      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      {/* Fade into terminal band */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 sm:h-48 bg-gradient-to-t from-zinc-950 via-zinc-950/85 to-transparent z-[1]"
        aria-hidden
      />

      <div className="relative z-[2] max-w-5xl mx-auto text-center space-y-3 sm:space-y-4">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
          <Zap size={16} />
          First Agentic Risk API · MCP-Ready · Pay-as-you-go
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-white">
          An Agentic Approach to Managing{' '}
          <span className="text-primary">Equity Risk.</span>
        </h1>

        <p className="max-w-3xl mx-auto text-base sm:text-lg md:text-xl text-zinc-400 font-medium leading-relaxed">
          From Market, Sector, and Subsector Attribution to Automated Hedging Logic—Directly Calibrate
          Your Entire Risk Stack via a Single Institutional-Grade API.
        </p>

        <p className="text-sm text-zinc-500 leading-relaxed -mt-0.5">No subscription. No seat fees.</p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-0.5 pb-0">
          <Link
            href="/pricing"
            className="group px-8 py-4 bg-primary hover:bg-primary/90 text-white text-lg font-semibold rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30"
          >
            Get Started
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            href="/docs/api"
            className="px-8 py-4 bg-zinc-800/50 hover:bg-zinc-800 text-white text-lg font-semibold rounded-lg border border-zinc-700 transition-all"
          >
            Read the Docs
          </Link>
        </div>
      </div>
    </section>
  );
}
