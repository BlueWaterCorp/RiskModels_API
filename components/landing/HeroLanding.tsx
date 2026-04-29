import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import MiniDecomposition from './MiniDecomposition';

export default function HeroLanding() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-20">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            RiskModels
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Risk benchmarks.
            <br />
            Tradeable hedge ratios.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Run any portfolio through a risk model. Benchmark it.
          </p>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Decouple market, sector, subsector, and residual risk — and get ETF hedge ratios in one call.
          </p>
          <p className="mt-4 text-sm font-medium text-zinc-500">
            No model build. No factor library. One call.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/installation"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-7 py-3.5 text-base font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Try it <ArrowRight size={18} />
            </Link>
            <Link
              href="/api-reference"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-7 py-3.5 text-base font-semibold text-white transition hover:border-zinc-600 hover:bg-zinc-800"
            >
              View API
            </Link>
          </div>
        </div>

        <div className="lg:col-span-5">
          <MiniDecomposition className="mx-auto w-full max-w-md" />
        </div>
      </div>
    </section>
  );
}
