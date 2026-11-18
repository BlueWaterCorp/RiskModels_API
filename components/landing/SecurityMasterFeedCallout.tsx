import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getLatestFeedExample } from '@/lib/feed-latest-example';

/**
 * Landing entry point to /security-master-feed. The example line is the newest
 * real event from the public Event Ledger reader; when it returns none, the
 * section shows no example. Never substitute a made-up one.
 */
export default async function SecurityMasterFeedCallout() {
  const example = await getLatestFeedExample();
  const who = example ? [example.ticker, example.company].filter(Boolean).join(' · ') : '';

  return (
    <section className="border-b border-zinc-800 bg-black px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
              Security master feed
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Every identity change, with the filing behind it
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              A daily, SEC-filing-cited feed of US equity identity and status events: ticker and
              name changes, delistings, mergers and splits.
            </p>
            {example && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Latest event{example.known_date ? ` · known ${example.known_date}` : ''}
                </p>
                <p className="mt-1 break-words text-zinc-200">
                  {who && <span className="font-semibold text-white">{who}: </span>}
                  {example.event}
                  {example.effective_date ? `, effective ${example.effective_date}` : ''}
                </p>
                {example.source_url && (
                  <a
                    href={example.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block break-all text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    {example.source_label ?? 'Source filing'}
                  </a>
                )}
              </div>
            )}
          </div>
          <Link
            href="/security-master-feed"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_10px_28px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400"
          >
            Join the list <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
