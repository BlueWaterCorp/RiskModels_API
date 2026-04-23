import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-white/10 bg-zinc-950 px-4 py-20 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgb(37_99_235/0.12),transparent_70%)]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl md:text-5xl">
          Stop guessing what{' '}
          <span className="text-primary">you own.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">
          Decouple any stock into four bets and hedge the ones you don&rsquo;t want
          &mdash; in one API call.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/get-key"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-white transition hover:bg-primary/90"
          >
            Get API key <ArrowRight size={18} />
          </Link>
          <Link
            href="#decompose-widget"
            className="inline-flex items-center justify-center rounded-lg border border-slate-600/80 bg-[#1e293b] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-[#334155]"
          >
            Try NVDA example
          </Link>
        </div>
      </div>
    </section>
  );
}
