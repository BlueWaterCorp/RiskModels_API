import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function HeroLanding() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-10 pt-12 sm:px-6 sm:pt-14 lg:px-8 lg:pb-12">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          RiskModels API
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl">
          Market beta is not enough.
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-balance text-lg font-medium leading-snug text-zinc-300 sm:text-xl md:text-2xl">
          Decompose every position into market, sector, subsector, and stock-specific layers — with ETF hedge ratios you can use from one API call.
        </p>
        <p className="mx-auto mt-6 font-mono text-[12px] tracking-[0.04em] text-zinc-500 sm:text-[13px]">
          ERM3 (Equity Risk Model v3) · raw-ETF hedges · agent-callable
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
        <p className="mt-3 text-xs text-zinc-500 sm:text-sm">
          Start in seconds — no setup required
        </p>
        <p className="mt-2 text-[11px] text-zinc-600 sm:text-xs">
          Free trial · Read-only · Keys server-side · Sub-120ms
        </p>
      </div>
    </section>
  );
}
