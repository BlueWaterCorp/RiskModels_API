import Link from 'next/link';
import { ArrowRight, Bot } from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';

const HERO_INSTALL = `npx riskmodels install`;

const HERO_PROMPT = `Compare AAPL and NVDA using RiskModels.
What am I really betting on?`;

/**
 * Agent-first hero: install command + first prompt before REST details.
 */
export default function HeroDecompose() {
  return (
    <section className="relative overflow-hidden bg-zinc-950 px-4 pb-12 pt-14 sm:px-6 sm:pt-16 lg:px-8 lg:pb-16">
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950/25" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      <div className="relative z-[2] mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            <Bot size={16} />
            Claude, Cursor, Codex, and VS Code
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tighter text-white sm:text-5xl md:text-6xl">
            Install once. Ask what{' '}
            <span className="text-primary">you&rsquo;re really betting on.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Use RiskModels inside Claude, Cursor, Codex, or VS Code. It turns
            stocks and portfolios into market, sector, subsector, and residual
            bets with chart-ready explanations.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/quickstart"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-white transition hover:bg-primary/90"
            >
              Install RiskModels <ArrowRight size={18} />
            </Link>
            <Link
              href="#install-paths"
              className="inline-flex items-center justify-center rounded-lg border border-slate-600/80 bg-[#1e293b] px-7 py-3.5 text-base font-semibold text-white transition hover:bg-[#334155]"
            >
              See all paths
            </Link>
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500">
            Need an API key first?{' '}
            <Link
              href="/get-key"
              className="font-medium text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
            >
              Get one here
            </Link>
            .
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Install
            </div>
            <CodeBlock code={HERO_INSTALL} language="bash" />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              First prompt
            </div>
            <CodeBlock code={HERO_PROMPT} language="text" />
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-zinc-400 sm:text-base">
          RiskModels returns plain-English summaries, reproducible API metadata,
          and <span className="text-white">chart_data</span> agents can render.
          Manual API docs are still here, but they are the fallback path.
        </p>
      </div>
    </section>
  );
}
