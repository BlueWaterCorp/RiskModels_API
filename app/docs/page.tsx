import Link from 'next/link';
import { getAllDocSlugs } from '@/lib/mdx';
import { docsNavSlugs } from '@/lib/docs-nav';

export const metadata = {
  title: 'RiskModels API Docs',
  description:
    'Start here: hierarchical equity risk decomposition, hedge ratios, and residual risk for quant developers and AI agents.',
  alternates: { canonical: '/docs' },
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

type Card = { href: string; title: string; body: string };

const CARDS: Card[] = [
  {
    href: '/installation',
    title: 'Quickstart',
    body: 'Get a key and make a first request with curl, Python or the command line.',
  },
  {
    href: '/docs/api',
    title: 'API guide',
    body: 'Every endpoint with SDK examples: decompose, metrics, rankings, batch and macro correlation.',
  },
  {
    href: '/docs/methodology',
    title: 'Methodology',
    body: 'The regression cascade, orthogonalization and hedge-ratio arithmetic.',
  },
  {
    href: '/docs/agent-integration',
    title: 'AI assistants',
    body: 'The hosted connector, client setup and the tools it exposes.',
  },
  {
    href: '/docs/macro-factors',
    title: 'Factor correlation',
    body: 'Correlate gross or ERM3-residual returns against 10 macro and 8 style factors.',
  },
  {
    href: '/docs/authentication',
    title: 'Authentication',
    body: 'OAuth2 client credentials, Bearer tokens, and the prepaid billing model.',
  },
];

export default function DocsHubPage() {
  assertDocsCoverage();

  return (
    <div>
      <header className="mb-10">
        <p className="rm-label">Documentation</p>
        <h1 className="rm-h1 mt-3 !text-[2.5rem]">RiskModels API documentation</h1>
        <p className="rm-lede mt-4 max-w-2xl">
          Guides to the endpoints, the model behind them, authentication and the connector for AI assistants.
        </p>
      </header>

      <ul className="divide-y divide-[var(--rm-rule)] border-y border-rule">
        {CARDS.map((card) => (
          <li key={card.href} className="grid gap-x-8 gap-y-1 py-4 lg:grid-cols-12">
            <Link href={card.href} className="rm-h3 rm-link lg:col-span-4">
              {card.title}
            </Link>
            <span className="rm-body lg:col-span-8">{card.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
