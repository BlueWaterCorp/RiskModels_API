import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Boxes,
  FileJson,
  GitBranch,
  KeyRound,
  Plug,
  ScrollText,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import CodeBlock from '@/components/CodeBlock';

export const metadata: Metadata = {
  title: 'For AI Agents — RiskModels',
  description:
    'Everything an agent (or the risk/compliance team approving it) needs to discover, trust, and call RiskModels: machine-readable manifests, pricing in-protocol, point-in-time reproducibility, and self-serve auth.',
};

type LinkCard = {
  title: string;
  href: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const DISCOVERY: LinkCard[] = [
  {
    title: 'Capability manifest',
    href: '/.well-known/agent-manifest.json',
    desc: 'One fetch: capabilities, pricing, reproducibility, and cross-links to every other artifact.',
    icon: FileJson,
  },
  {
    title: 'OpenAPI spec',
    href: '/openapi.json',
    desc: 'Full REST contract with per-endpoint x-pricing extensions.',
    icon: ScrollText,
  },
  {
    title: 'MCP server',
    href: '/.well-known/mcp.json',
    desc: 'Streamable-HTTP MCP endpoint with discovery + live-data tools.',
    icon: Plug,
  },
  {
    title: 'llms.txt',
    href: '/llms.txt',
    desc: 'Crawler-friendly summary, including a shared demo key when the host enables one.',
    icon: Boxes,
  },
];

const TRUST: { title: string; body: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  {
    title: 'Point-in-time & reproducible',
    body: 'Decompositions are deterministic and replayable back to 2006-01-04. Every response carries model_version, data_as_of, and factor_set_id so any number can be cited and re-derived.',
    icon: GitBranch,
  },
  {
    title: 'Auditable & disclosed',
    body: 'request_id correlates response → billing event. Data handling, retention, and training policy are published machine-readably at /.well-known/agentic-disclosure.json.',
    icon: ShieldCheck,
  },
  {
    title: 'Cost in the protocol',
    body: 'Every call returns _agent.cost_usd in the body and X-API-Cost-USD in headers. Pay-per-call, $20 free credits, no subscription. HTTP 402 when balance runs low — never a surprise.',
    icon: Zap,
  },
];

const PROVISION_CODE = `# 1. Self-provision free starter credits (no human in the loop)
curl -X POST https://riskmodels.app/api/auth/provision-free

# 2. Call any endpoint with the Bearer token you receive
curl -X POST https://riskmodels.app/api/decompose \\
  -H "Authorization: Bearer rm_agent_..." \\
  -H "Content-Type: application/json" \\
  -d '{"ticker":"NVDA"}'

# 3. Retry safely — same Idempotency-Key never double-charges
#    -H "Idempotency-Key: <uuid>"`;

const TOOLDEF_CODE = `# Emit ready-to-paste tool definitions for your agent framework
npm install -g riskmodels@latest
riskmodels manifest --format anthropic   # or: openai | zed`;

export default function ForAgentsPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[90rem] overflow-x-hidden bg-zinc-950">
      {/* Hero */}
      <section className="border-b border-zinc-800 px-4 pb-14 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            For AI agents
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Specialized risk intelligence, one call away
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-400 sm:text-lg">
            Precise L1/L2/L3 factor decomposition and ETF hedge ratios for ~3,000 US equities — JSON-native,
            metered, and reproducible. An agent calls it in one shot instead of reasoning from training data.
          </p>
          <p className="mx-auto mt-5 max-w-2xl rounded-lg border border-emerald-500/25 bg-emerald-950/35 px-4 py-3 text-left text-sm leading-relaxed text-emerald-100/90">
            <strong className="text-emerald-200">Approving us for your agent fleet?</strong> This page is the
            one-pager for risk &amp; compliance teams — discovery artifacts, data policy, reproducibility
            guarantees, and pricing are all linked below and published machine-readably.
          </p>
        </div>
      </section>

      {/* Why call vs. self-compute */}
      <section className="border-b border-zinc-800 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold text-white">Why call us instead of reasoning</h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            A general model approximating a factor decomposition from training data is slow, expensive, and
            unauditable. A single RiskModels call returns the exact, current four-layer attribution and the ETF
            hedge map — with a model version and data date you can cite. Live processing latency and service
            health are published at{' '}
            <Link className="font-mono text-emerald-300 underline underline-offset-2 hover:text-emerald-200" href="/api/health">
              /api/health
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Discovery */}
      <section className="border-b border-zinc-800 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-white">Discover us programmatically</h2>
          <p className="mt-2 text-sm text-zinc-400">Four machine-readable entry points. Start with the manifest — it links to the rest.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {DISCOVERY.map(({ title, href, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-emerald-500/30 hover:bg-white/[0.05]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="inline-flex rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
                    <Icon size={18} />
                  </span>
                  <h3 className="text-lg font-semibold text-white">{title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">{desc}</p>
                <span className="mt-4 font-mono text-xs text-emerald-400/80 group-hover:text-emerald-300">{href} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Onboard */}
      <section className="border-b border-zinc-800 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="inline-flex rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
              <KeyRound size={18} />
            </span>
            <h2 className="text-2xl font-semibold text-white">Onboard without a human</h2>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-zinc-400">
            An agent goes from never-heard-of-us to first paid call in three requests. Bearer auth
            (<code className="rounded bg-black/35 px-1 font-mono">rm_agent_*</code> /{' '}
            <code className="rounded bg-black/35 px-1 font-mono">rm_user_*</code>), idempotent retries, and metered
            pricing. Full key management lives at{' '}
            <Link className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200" href="/get-key">
              get a key
            </Link>{' '}
            and{' '}
            <Link className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200" href="/pricing">
              pricing
            </Link>
            .
          </p>
          <CodeBlock code={PROVISION_CODE} language="bash" filename="onboard" />
          <p className="mb-3 mt-8 text-sm text-zinc-400">Generate tool definitions for your framework:</p>
          <CodeBlock code={TOOLDEF_CODE} language="bash" filename="tool-defs" />
        </div>
      </section>

      {/* Trust */}
      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-white">Trust &amp; compliance signals</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Built for regulated workflows — 13F structure, fund attribution, portfolio risk.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {TRUST.map(({ title, body, icon: Icon }) => (
              <div key={title} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="inline-flex rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
                    <Icon size={18} />
                  </span>
                  <h3 className="text-base font-semibold text-white">{title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-12 flex max-w-2xl flex-wrap justify-center gap-x-6 gap-y-2 text-center text-xs text-zinc-500">
            <Link className="hover:text-zinc-300" href="/.well-known/agentic-disclosure.json">Agentic disclosure</Link>
            <Link className="hover:text-zinc-300" href="/docs/methodology">Methodology</Link>
            <Link className="hover:text-zinc-300" href="/docs/agent-integration">Agent integration guide</Link>
            <Link className="hover:text-zinc-300" href="/api-reference">OpenAPI reference</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
