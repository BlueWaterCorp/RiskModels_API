import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function HeroLanding() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-10 pt-12 sm:px-6 sm:pt-14 lg:px-8 lg:pb-12">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          RiskModels
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl">
          Market beta is not enough.
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-balance text-xl font-medium leading-snug text-zinc-300 sm:text-2xl md:text-3xl">
          See every source of risk — and trade on it.
        </p>
        <p className="mx-auto mt-6 font-mono text-[13px] tracking-[0.04em] text-zinc-500 sm:text-sm">
          PI = Actionable risk (one API call)
        </p>
        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/installation"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-9 py-[18px] text-base font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_10px_28px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400"
          >
            Try it <ArrowRight size={18} />
          </Link>
          <Link
            href="/api-reference"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-9 py-[18px] text-base font-semibold text-white transition hover:border-zinc-600 hover:bg-zinc-800"
          >
            View API
          </Link>
        </div>
        <p className="mt-3 text-xs text-zinc-500 sm:text-sm">
          Start in seconds — no setup required
        </p>
        <p className="mt-2 text-[11px] text-zinc-600 sm:text-xs">
          Free trial · No data leaves your system · Sub-120ms
        </p>
      </div>
    </section>
  );
}
