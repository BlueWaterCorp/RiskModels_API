import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Buyer-facing entry point to the /compare/barra-axioma positioning page.
 * Sits below the research-proof block — the buyer evaluating enterprise risk
 * platforms is the same reader who just saw the methodology credibility.
 */
export default function CompareCallout() {
  return (
    <section className="border-b border-zinc-800 bg-black px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              Evaluating alternatives?
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Evaluating against Barra or Axioma?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              See where RiskModels fits — API-native decomposition with tradable ETF
              hedge ratios, for teams that need holdings-level risk without an enterprise
              platform.
            </p>
          </div>
          <Link
            href="/compare/barra-axioma"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_10px_28px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400"
          >
            Compare <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
