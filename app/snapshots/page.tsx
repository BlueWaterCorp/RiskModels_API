import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import SnapshotProof from '@/components/landing/SnapshotProof';

export const metadata: Metadata = {
  title: 'Snapshots — RiskModels',
  description:
    'Institutional risk artifacts rendered from a single ERM3 API call. NVDA single-stock due diligence and AGTHX fund-fit examples.',
};

export default function SnapshotsPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden bg-zinc-950">
      <section className="border-b border-zinc-800 px-4 pb-12 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Snapshots
          </p>
          <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
            What ERM3 returns when you ask it to render.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Every decomposition the API computes can come back as JSON or as a printable
            institutional artifact. The two examples below were generated end-to-end from
            single API calls — no manual chart-building, no post-processing.
          </p>
        </div>
      </section>

      <SnapshotProof />

      <section className="border-b border-zinc-800 bg-zinc-950 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
            Run it on your book
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Same engine, your positions.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Both snapshots above are rendered from the same call developers use programmatically.
            Hit the API from code, the CLI, or an agent — the JSON powers your pipeline and the
            same call can render a one-pager for your IC.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/get-key"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Get API Key <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/api-reference"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
            >
              View API Docs
            </Link>
            <a
              href="https://riskmodels.org/research?utm_source=riskmodels-app&utm_medium=snapshots-page&utm_campaign=cross-site"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-transparent px-6 py-3 text-sm font-semibold text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            >
              Read the research <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
