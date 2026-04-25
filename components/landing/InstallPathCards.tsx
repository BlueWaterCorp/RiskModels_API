import Link from 'next/link';
import { Bot, Package, Terminal } from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';

const PATHS = [
  {
    title: 'AI Agent',
    description: 'Install the MCP server once, then ask Claude, Cursor, Codex, or VS Code what you really own.',
    command: 'npx riskmodels install',
    icon: Bot,
    href: '/quickstart',
  },
  {
    title: 'Terminal',
    description: 'Run comparisons and diagnostics directly from the command line.',
    command: 'riskmodels compare AAPL NVDA',
    icon: Terminal,
    href: '/quickstart',
  },
  {
    title: 'SDK',
    description: 'Call the agent-ready TypeScript SDK and get chart_data, summaries, and reproducible API metadata.',
    command: 'npm install @riskmodels/sdk',
    icon: Package,
    href: '/docs/api',
  },
] as const;

export default function InstallPathCards() {
  return (
    <section className="border-t border-zinc-800/80 bg-zinc-950 px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            Choose your path
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            One install command. Three ways in.
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Start inside your AI agent, drop to the terminal when you need repeatability,
            or wire the SDK into your own product.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {PATHS.map(({ title, description, command, icon: Icon, href }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-primary/40 hover:bg-white/[0.07]"
            >
              <div className="mb-4 inline-flex rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                <Icon size={20} />
              </div>
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 min-h-16 text-sm leading-relaxed text-zinc-400">{description}</p>
              <div className="mt-5">
                <CodeBlock code={command} language="bash" />
              </div>
              <Link
                href={href}
                className="mt-4 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                Open {title.toLowerCase()} path
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
