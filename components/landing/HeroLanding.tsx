import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export default function HeroLanding() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-12 pt-12 sm:px-6 sm:pt-14 lg:px-8 lg:pb-14">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          RiskModels API
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-bold leading-[1.06] tracking-tight text-white sm:text-4xl md:text-[2.875rem] lg:text-5xl">
          Your portfolio already has a benchmark. You just haven&rsquo;t seen it.
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-balance text-base font-medium leading-snug text-zinc-300 sm:text-lg md:text-xl">
          Decompose every position into market, sector, subsector, and stock-specific layers —
          with ETF hedge ratios you can use from one API call.
        </p>
        <p className="mx-auto mt-6 font-mono text-[12px] tracking-[0.04em] text-zinc-500 sm:text-[13px]">
          Numbers-first answers from live ERM3 data · hedge ratios in dollars of ETF per $1 of stock
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/get-key"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-7 py-[16px] text-base font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_10px_28px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400"
          >
            Get API Key <ArrowRight size={18} />
          </Link>
          <Link
            href="/api-reference"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-7 py-[16px] text-base font-semibold text-white transition hover:border-zinc-600 hover:bg-zinc-800"
          >
            View Docs
          </Link>
          <Link
            href="#worked-example"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-transparent px-7 py-[16px] text-base font-semibold text-zinc-300 transition hover:border-zinc-700 hover:text-white"
          >
            See the Worked Example
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono uppercase tracking-[0.18em] text-emerald-300">
            <ShieldCheck className="size-3" aria-hidden />
            Read-only · Keys server-side
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 font-mono uppercase tracking-[0.18em] text-zinc-400">
            ERM3 (Equity Risk Model v3)
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 font-mono uppercase tracking-[0.18em] text-zinc-400">
            Sub-120 ms
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 font-mono uppercase tracking-[0.18em] text-zinc-400">
            Agent-callable
          </span>
        </div>
      </div>
    </section>
  );
}
