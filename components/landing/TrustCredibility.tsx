import Link from 'next/link';
import { BookOpen, FileCode, GitBranch } from 'lucide-react';

const POINTS = [
  {
    icon: GitBranch,
    title: 'Additive decomposition',
    body: 'Four layers, no hidden factors. `market_er + sector_er + subsector_er + residual_er ≈ 1`.',
  },
  {
    icon: FileCode,
    title: 'Same model drives return + risk',
    body: 'Hedge ratios are the dollar weights from the same ERM3 regression that produces explained risk.',
  },
  {
    icon: BookOpen,
    title: 'Fully documented',
    body: 'OpenAPI spec, semantic field reference, and methodology notes are public.',
  },
];

export default function TrustCredibility() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tighter text-white sm:text-4xl">
            Transparent <span className="text-primary">methodology.</span>
          </h2>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <Icon size={24} className="text-primary" />
              <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/docs/methodology"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-zinc-200 transition hover:bg-white/10"
          >
            Methodology
          </Link>
          <Link
            href="/docs/api"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-zinc-200 transition hover:bg-white/10"
          >
            API reference
          </Link>
          <Link
            href="https://github.com/"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-zinc-200 transition hover:bg-white/10"
          >
            Python SDK
          </Link>
        </div>
      </div>
    </section>
  );
}
