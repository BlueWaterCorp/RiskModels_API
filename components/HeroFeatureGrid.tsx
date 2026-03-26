import Link from 'next/link';
import { Terminal, Bot, Shield } from 'lucide-react';

export interface HeroFeatureGridProps {
  embedded?: boolean;
}

export default function HeroFeatureGrid({ embedded = false }: HeroFeatureGridProps) {
  const cardBase = embedded
    ? 'rounded-xl border border-white/10 bg-zinc-950/40 p-4 backdrop-blur-sm transition-colors hover:border-white/15 min-w-0 sm:p-[1.125rem]'
    : 'rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-5 backdrop-blur-sm transition-colors hover:border-zinc-700/90 min-w-0';

  const grid = (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
      <div className={cardBase}>
        <Terminal className="text-primary mb-3" size={26} />
        <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Developer-First</h3>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          OpenAPI 3.0 spec, TypeScript/Python/cURL examples. Clean REST API with full type safety.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/api-reference" className="text-primary hover:underline">
            API Spec →
          </Link>
          <Link href="/quickstart#code-examples" className="text-primary hover:underline">
            Quickstart →
          </Link>
          <a
            href="https://pypi.org/project/riskmodels-py/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            PyPI (riskmodels-py) →
          </a>
          <a
            href="https://github.com/Cerebellum-Archive/RiskModels_API/tree/main/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            SDK source →
          </a>
        </div>
      </div>

      <div className={cardBase}>
        <Bot className="text-primary mb-3" size={26} />
        <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Agentic Delegation</h3>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          Pass your portfolio and a task — the agent returns factor exposures, drift alerts, and hedge
          suggestions. No query logic required.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/docs/authentication" className="text-primary hover:underline">
            Agent Guide →
          </Link>
          <Link href="/get-key" className="text-primary hover:underline">
            Get Key →
          </Link>
        </div>
      </div>

      <div className={cardBase}>
        <Shield className="text-primary mb-3" size={26} />
        <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Institutional Grade</h3>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          ~3,000 tickers, 15+ years history, daily updates. Powered by ERM3 regression engine.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/docs/methodology" className="text-primary hover:underline">
            Methodology →
          </Link>
          <Link href="/docs/api" className="text-primary hover:underline">
            Docs →
          </Link>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return <div className="w-full min-w-0">{grid}</div>;
  }

  return (
    <section
      aria-label="Platform highlights"
      className="relative w-full bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-zinc-950/0 via-zinc-950/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/25 to-transparent" />
      <div className="mx-auto max-w-5xl min-w-0">{grid}</div>
    </section>
  );
}
