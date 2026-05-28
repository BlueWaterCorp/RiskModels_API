import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';

const CARDS = [
  {
    eyebrow: 'For developers & agents',
    body: 'Call risk decomposition from your app, notebook, or agent workflow. JSON in, hedge ratios out.',
    cta: 'View API Docs',
    href: '/api-reference',
    external: false,
  },
  {
    eyebrow: 'For portfolio managers',
    body: 'See what each position is really betting on — and what ETF trades hedge it. NVDA single-stock and AGTHX fund-fit snapshots, rendered from one API call.',
    cta: 'See sample snapshots',
    href: '/snapshots',
    external: false,
  },
  {
    eyebrow: 'For allocators & diligence',
    body: 'Separate benchmark exposure from stock selection in disclosed 13F books.',
    cta: 'Read 13F Research',
    href: 'https://riskmodels.org/research/part-2-risk-structure-13f-filings?utm_source=riskmodels-app&utm_medium=audience-card&utm_campaign=cross-site',
    external: true,
  },
] as const;

export default function AudienceCards() {
  return (
    <section className="border-b border-zinc-800 bg-black px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            Built for three workflows
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Pick the path that matches your job.
          </h2>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {CARDS.map((card) => (
            <div
              key={card.eyebrow}
              className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 transition hover:border-emerald-500/40"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
                {card.eyebrow}
              </p>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-zinc-300">{card.body}</p>
              {card.external ? (
                <a
                  href={card.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  {card.cta} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <Link
                  href={card.href}
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  {card.cta} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
