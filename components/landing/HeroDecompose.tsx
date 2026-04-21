import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';

const HERO_CURL = `curl -X POST https://riskmodels.app/api/decompose \\
  -H "Authorization: Bearer $RISKMODELS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ticker":"NVDA"}'`;

const HERO_RESPONSE = `{
  "ticker": "NVDA",
  "exposure": {
    "market":    { "er": 0.45, "hr": 1.10, "hedge_etf": "SPY" },
    "sector":    { "er": 0.22, "hr": 0.35, "hedge_etf": "XLK" },
    "subsector": { "er": 0.20, "hr": 0.60, "hedge_etf": "SMH" },
    "residual":  { "er": 0.13, "hr": null, "hedge_etf": null }
  },
  "hedge": { "SPY": -1.10, "XLK": -0.35, "SMH": -0.60 }
}`;

/**
 * Agent-first hero: one callable endpoint, live request + response side by
 * side, primary CTA anchors to the MAG7 decompose widget below the fold.
 */
export default function HeroDecompose() {
  return (
    <section className="relative overflow-hidden bg-zinc-950 px-4 pb-12 pt-14 sm:px-6 sm:pt-16 lg:px-8 lg:pb-16">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950/25" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      <div className="relative z-[2] mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            <Zap size={16} />
            One call. Four bets. Ready-to-short hedge ratios.
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tighter text-white sm:text-5xl md:text-6xl">
            Turn any stock into a{' '}
            <span className="text-primary">hedgeable trade.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Decompose any position into market, sector, and idiosyncratic
            exposure &mdash; and get exact hedge ratios in one API call.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="#decompose-widget"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-white transition hover:bg-primary/90"
            >
              Try it now <ArrowRight size={18} />
            </Link>
            <Link
              href="/docs/api#decompose"
              className="inline-flex items-center justify-center rounded-lg border border-slate-600/80 bg-[#1e293b] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-[#334155]"
            >
              View API docs
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Request
            </div>
            <CodeBlock code={HERO_CURL} language="bash" />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Response
            </div>
            <CodeBlock code={HERO_RESPONSE} language="json" />
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-zinc-400 sm:text-base">
          NVDA isn&rsquo;t just &ldquo;tech&rdquo; &mdash; it&rsquo;s a{' '}
          <span className="text-white">semiconductor + market beta</span> trade
          with a negative residual. Hedge each layer directly.
        </p>
      </div>
    </section>
  );
}
