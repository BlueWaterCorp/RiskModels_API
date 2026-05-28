import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

const SNAPSHOTS = [
  {
    ticker: 'NVDA',
    title: 'Single-stock due diligence snapshot',
    detail:
      'RiskModels API output: cumulative returns, ERM3 factor bridge, peer residual analytics, and hedgeable risk layers.',
    image: '/snapshots/nvda_dd_latest.png',
    href: '/snapshots/nvda_dd_latest.png',
  },
  {
    ticker: 'AGTHX',
    title: 'Mutual fund fit snapshot',
    detail:
      'Funds pipeline output: 5-year NAV attribution, top holdings risk contribution, active risk mix, and summary profile.',
    image: '/snapshots/agthx_f1.png',
    href: '/snapshots/agthx_f1.png',
  },
] as const;

export default function SnapshotProof() {
  return (
    <section className="border-b border-zinc-800 bg-black px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              API output — institutional artifacts
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              From one API call to a research-desk one-pager.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              Same decomposition engine, two output formats — JSON for code, printable PDF for
              memos. Single-name due diligence (NVDA) and fund fit (AGTHX) below, both generated
              from one call each.
            </p>
          </div>
          <Link
            href="/api-reference"
            className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300"
          >
            Build from the API <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {SNAPSHOTS.map((snapshot) => (
            <Link
              key={snapshot.ticker}
              href={snapshot.href}
              className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 shadow-2xl shadow-black/30 transition hover:border-emerald-500/60"
            >
              <div className="relative aspect-[4/3] bg-white">
                <Image
                  src={snapshot.image}
                  alt={`${snapshot.ticker} ${snapshot.title}`}
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="object-cover"
                  priority={snapshot.ticker === 'NVDA'}
                />
              </div>
              <div className="p-5">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                  {snapshot.ticker}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">{snapshot.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{snapshot.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
