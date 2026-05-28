import { ExternalLink } from 'lucide-react';

const UTM = 'utm_source=riskmodels-app&utm_medium=research-proof&utm_campaign=cross-site';

const ARTICLES = [
  {
    label: 'Part 1 · One Position, Four Bets',
    summary: 'AAPL vs NVDA, XOM vs KMI, MAG7 DNA.',
    href: `https://riskmodels.org/research/part-1-hidden-concentration?${UTM}`,
  },
  {
    label: 'Part 2 · Risk Structure in 13F Filings',
    summary: 'Buffett, Ackman, Lone Pine, Tiger Global, Baupost.',
    href: `https://riskmodels.org/research/part-2-risk-structure-13f-filings?${UTM}`,
  },
  {
    label: 'Methodology · ERM3 Engine Design',
    summary: 'Hierarchical orthogonalization, L-star, hedge ratios, capacity.',
    href: `https://riskmodels.org/methodology?${UTM}`,
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
            <blockquote className="mt-4 border-l-2 border-emerald-500/60 pl-5 text-lg leading-relaxed text-zinc-200 sm:text-xl">
              &ldquo;Much of what gets labeled as the &lsquo;factor zoo&rsquo; is already sitting in
              plain sight — embedded in sector and subsector exposures as tradable risk. The
              proliferation of factors is often a labeling exercise.&rdquo;
            </blockquote>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              — Part 1 · One Position, Four Bets
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
                Read on riskmodels.org <ExternalLink className="h-3 w-3" />
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
