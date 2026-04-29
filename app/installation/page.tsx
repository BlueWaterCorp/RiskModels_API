import type { Metadata } from 'next';
import { Bot, Code2, Globe, Terminal } from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';
import QuickstartTyping from '@/components/QuickstartTyping';

export const metadata: Metadata = {
  title: 'Installation — RiskModels',
  description: 'Use RiskModels from Python, CLI, API, or your AI agent.',
};

type Block = {
  id: string;
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  setup:
    | { kind: 'code'; code: string; language: string; filename: string }
    | { kind: 'caption'; text: string };
  firstActionLabel: string;
  firstActionCode: string;
  firstActionLanguage: string;
  outcome: string;
};

const BLOCKS: Block[] = [
  {
    id: 'python',
    title: 'Python',
    icon: Code2,
    setup: {
      kind: 'code',
      code: 'pip install riskmodels',
      language: 'bash',
      filename: 'install',
    },
    firstActionLabel: 'First action',
    firstActionCode: 'decompose("NVDA")',
    firstActionLanguage: 'python',
    outcome: '→ exposures + hedge ratios',
  },
  {
    id: 'cli',
    title: 'CLI',
    icon: Terminal,
    setup: {
      kind: 'code',
      code: 'npm install -g riskmodels-cli',
      language: 'bash',
      filename: 'install',
    },
    firstActionLabel: 'First action',
    firstActionCode: 'riskmodels decompose NVDA',
    firstActionLanguage: 'bash',
    outcome: '→ exposures + hedge ratios',
  },
  {
    id: 'api',
    title: 'API',
    icon: Globe,
    setup: {
      kind: 'code',
      code: 'POST /decompose',
      language: 'http',
      filename: 'endpoint',
    },
    firstActionLabel: 'First action',
    firstActionCode: 'curl -X POST /decompose',
    firstActionLanguage: 'bash',
    outcome: '→ exposures + hedge ratios',
  },
  {
    id: 'agent',
    title: 'Agent',
    icon: Bot,
    setup: { kind: 'caption', text: 'Use in Claude / Cursor.' },
    firstActionLabel: 'Ask',
    firstActionCode: '"Explain NVDA risk"',
    firstActionLanguage: 'text',
    outcome: '→ exposures + hedge ratios',
  },
];

export default function InstallationPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden bg-zinc-950">
      <section className="border-b border-zinc-800 px-4 pb-12 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Install
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Get started in seconds
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-400 sm:text-lg">
            Use RiskModels from Python, CLI, API, or your AI agent.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl">
          <QuickstartTyping className="text-center" />
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-5 md:grid-cols-2">
            {BLOCKS.map(({ id, title, icon: Icon, setup, firstActionLabel, firstActionCode, firstActionLanguage, outcome }) => (
              <div
                key={id}
                className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="inline-flex rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
                    <Icon size={18} />
                  </span>
                  <h2 className="text-lg font-semibold text-white">{title}</h2>
                </div>

                <div className="space-y-4">
                  {setup.kind === 'code' ? (
                    <CodeBlock
                      code={setup.code}
                      language={setup.language}
                      filename={setup.filename}
                    />
                  ) : (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                      {setup.text}
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      {firstActionLabel}
                    </p>
                    <CodeBlock
                      code={firstActionCode}
                      language={firstActionLanguage}
                      filename={firstActionLanguage === 'text' ? 'prompt' : firstActionLanguage}
                    />
                  </div>
                </div>

                <p className="mt-5 text-xs font-mono text-emerald-400/80">{outcome}</p>
              </div>
            ))}
          </div>

          <ul className="mx-auto mt-12 max-w-2xl space-y-1.5 text-center text-xs text-zinc-500">
            <li>No auth required to understand usage</li>
            <li>No walls before first call</li>
            <li>Copy-paste friendly</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
