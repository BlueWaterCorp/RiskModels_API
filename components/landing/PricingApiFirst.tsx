import Link from 'next/link';
import { Check } from 'lucide-react';

const POINTS = [
  'Pay per call',
  'No seats',
  'No enterprise lock-in',
  'Start free &mdash; $20 in credits',
];

export default function PricingApiFirst() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl">
          Pricing, <span className="text-primary">API-first.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
          Designed for experimentation and agent workflows.
        </p>

        <ul className="mx-auto mt-8 grid max-w-md gap-2 text-left">
          {POINTS.map((p) => (
            <li
              key={p}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200"
            >
              <Check size={16} className="shrink-0 text-emerald-400" />
              <span dangerouslySetInnerHTML={{ __html: p }} />
            </li>
          ))}
        </ul>

        <div className="mt-8 flex justify-center">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center rounded-lg border border-slate-600/80 bg-[#1e293b] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#334155]"
          >
            See full pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
