import { Bot, CheckCircle2 } from 'lucide-react';

const PRINCIPLES = [
  'Deterministic outputs &mdash; no black-box factors',
  'Clean JSON schema, validated via OpenAPI',
  'Fast response times (sub-200ms p95)',
  'MCP-ready: works in Claude, Cursor, LangChain',
];

const USE_CASES = [
  '"Explain why my portfolio lost money."',
  '"Suggest a hedge without selling positions."',
  '"Convert a thesis into the right instrument."',
];

export default function BuiltForAgents() {
  return (
    <section className="relative bg-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-4 py-1.5 text-xs font-semibold text-purple-300">
            <Bot size={14} />
            Designed for LLM workflows
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tighter text-white sm:text-4xl">
            Built for <span className="text-primary">agents.</span>
          </h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">
              What you get
            </h3>
            <ul className="space-y-3">
              {PRINCIPLES.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm text-zinc-200">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                  <span dangerouslySetInnerHTML={{ __html: p }} />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">
              Example prompts
            </h3>
            <ul className="space-y-3">
              {USE_CASES.map((u) => (
                <li
                  key={u}
                  className="rounded-lg border border-white/10 bg-zinc-900/50 px-4 py-2.5 font-mono text-sm text-zinc-300"
                >
                  {u}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
