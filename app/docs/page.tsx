import Link from 'next/link';
import { getAllDocSlugs } from '@/lib/mdx';
import { docsNavSlugs } from '@/lib/docs-nav';

export const metadata = {
  title: 'RiskModels API Docs',
  description:
    'Start here: hierarchical equity risk decomposition, hedge ratios, and residual risk for quant developers and AI agents.',
};

// Build-time guard: every MDX page on disk must be listed in the sidebar nav,
// otherwise it would be unreachable. Fail loudly instead of silently orphaning.
function assertDocsCoverage() {
  const inNav = new Set(docsNavSlugs());
  const missing = getAllDocSlugs().filter((slug) => !inNav.has(slug));
  if (missing.length > 0) {
    throw new Error(
      `Docs pages missing from lib/docs-nav.ts (would be orphaned): ${missing.join(
        ', '
      )}. Add each /docs/<slug> to DOCS_NAV.`
    );
  }
}

type Card = { href: string; emoji: string; title: string; body: string; external?: boolean };

const CARDS: Card[] = [
  {
    href: '/installation',
    emoji: '🚀',
    title: 'Get started',
    body: 'Install the Python SDK, provision an API key, and make your first decomposition call.',
  },
  {
    href: '/docs/api',
    emoji: '⚡',
    title: 'API guide',
    body: 'Every endpoint with SDK examples — decompose, metrics, rankings, Lstar, batch, and macro correlation.',
  },
  {
    href: '/docs/methodology',
    emoji: '📐',
    title: 'Methodology & ERM3',
    body: 'The regression cascade, orthogonalization, hedge-ratio math, and the engine design behind it.',
  },
  {
    href: '/docs/agent-integration',
    emoji: '🤖',
    title: 'Agents & MCP',
    body: 'MCP server, agent-native SDK helpers, and prompt patterns for autonomous quant workflows.',
  },
  {
    href: '/docs/macro-factors',
    emoji: '📈',
    title: 'Factor correlation',
    body: 'Correlate gross or ERM3-residual returns against 10 macro and 8 style factors.',
  },
  {
    href: '/docs/authentication',
    emoji: '🔐',
    title: 'Authentication',
    body: 'OAuth2 client credentials, Bearer tokens, and the prepaid billing model.',
  },
];

export default function DocsHubPage() {
  assertDocsCoverage();

  return (
    <div>
      <header className="mb-10">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400 mb-3">
          Documentation
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-100 mb-3">RiskModels API Docs</h1>
        <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
          The <strong className="text-zinc-300">ERM3</strong> hierarchical equity risk model as an
          API — residual risk, hedge ratios, and explained risk for quant developers and AI agents.
          Separate factor exposure from the idiosyncratic bet so you can hedge what you don&apos;t
          want.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-primary/50 hover:bg-zinc-900 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{card.emoji}</span>
              <span className="font-semibold text-zinc-100 group-hover:text-primary transition-colors text-sm">
                {card.title}
              </span>
            </div>
            <span className="block text-xs text-zinc-500 leading-relaxed">{card.body}</span>
          </Link>
        ))}
      </div>

    </div>
  );
}
