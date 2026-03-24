import Link from 'next/link';
import { Terminal, Bot, Shield } from 'lucide-react';

export default function HeroFeatureGrid() {
  return (
    <section
      aria-label="Platform highlights"
      className="relative w-full px-4 sm:px-6 lg:px-8 pb-24 lg:pb-32"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-zinc-950/0 via-zinc-950/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/25 to-transparent" />
      <div className="max-w-5xl mx-auto pt-12 sm:pt-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          <div className="p-5 rounded-xl bg-zinc-900/35 border border-zinc-800/80 backdrop-blur-sm hover:border-zinc-700/90 transition-colors">
            <Terminal className="text-primary mb-3" size={26} />
            <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Developer-First</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              OpenAPI 3.0 spec, TypeScript/Python/cURL examples. Clean REST API with full type safety.
            </p>
            <div className="flex gap-3 text-xs">
              <Link href="/api-reference" className="text-primary hover:underline">
                API Spec →
              </Link>
              <Link href="/quickstart#code-examples" className="text-primary hover:underline">
                Quickstart →
              </Link>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-zinc-900/35 border border-zinc-800/80 backdrop-blur-sm hover:border-zinc-700/90 transition-colors">
            <Bot className="text-primary mb-3" size={26} />
            <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Agentic Delegation</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              Pass your portfolio and a task — the agent returns factor exposures, drift alerts, and hedge
              suggestions. No query logic required.
            </p>
            <div className="flex gap-3 text-xs">
              <Link href="/docs/authentication" className="text-primary hover:underline">
                Agent Guide →
              </Link>
              <Link href="/get-key" className="text-primary hover:underline">
                Get Key →
              </Link>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-zinc-900/35 border border-zinc-800/80 backdrop-blur-sm hover:border-zinc-700/90 transition-colors">
            <Shield className="text-primary mb-3" size={26} />
            <h3 className="text-lg font-semibold text-white tracking-tight mb-2">Institutional Grade</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              ~3,000 tickers, 15+ years history, daily updates. Powered by ERM3 regression engine.
            </p>
            <div className="flex gap-3 text-xs">
              <Link href="/docs/methodology" className="text-primary hover:underline">
                Methodology →
              </Link>
              <Link href="/docs/api" className="text-primary hover:underline">
                Docs →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
