import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';

const UTM = 'utm_source=riskmodels-app&utm_medium=research-proof&utm_campaign=cross-site';

const ARTICLES = [
  {
    label: 'Part 1 · One Position, Four Bets',
    summary: 'AAPL vs NVDA, XOM vs KMI, MAG7 DNA.',
    href: `https://riskmodels.org/research/part-1-hidden-concentration?${UTM}`,
    cta: 'Read on riskmodels.org',
  },
  {
    label: 'Part 2 · Risk Structure in 13F Filings',
    summary: 'Buffett, Ackman, Lone Pine, Tiger Global, Baupost.',
    href: `https://riskmodels.org/research/part-2-risk-structure-13f-filings?${UTM}`,
    cta: 'Read on riskmodels.org',
  },
  {
    label: 'Methodology · ERM3 Engine Design',
    summary: 'Factor definitions, hierarchical orthogonalization, L-star, and hedge-ratio construction.',
    href: `https://riskmodels.org/methodology?${UTM}`,
    cta: 'Read the methodology',
  },
] as const;

export default function ResearchProof() {
  return (
    <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              The research behind the model
            </p>
            <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Published method. Open evidence.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-zinc-300 sm:text-base">
              The factor definitions, hierarchical orthogonalization, L-star, and hedge-ratio
              construction are published so the four-layer map can be examined rather than taken
              on faith.
            </p>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Published methodology. Open research examples. Reproducible decomposition logic.
            Real citations (Frisch-Waugh-Lovell, Cremers-Petajisto, Harvey-Liu-Zhu, Grinold-Kahn).
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {ARTICLES.map((article) => (
            <a
              key={article.label}
              href={article.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col rounded-xl border border-zinc-800 bg-black/40 p-5 transition hover:border-emerald-500/40"
            >
              <p className="text-sm font-semibold text-white">{article.label}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{article.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
                {article.cta} <ExternalLink className="h-3 w-3" />
              </span>
            </a>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/snapshots"
            className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-emerald-300"
          >
            See full institutional snapshots — what ERM3 renders end-to-end
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
