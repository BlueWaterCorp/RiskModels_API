// Single source of truth for the docs hub + sidebar navigation.
//
// Pure data (no `fs`) so it can be imported by the client-side sidebar. The set
// of /docs/<slug> entries here is checked against the actual MDX files on disk
// at build time (see app/docs/page.tsx) — adding content/docs/<slug>.mdx without
// listing it here fails the build instead of silently orphaning the page.

export type DocsNavItem = {
  href: string;
  label: string;
  /** Opens in a new tab (off-portal target, e.g. llms.txt). */
  external?: boolean;
};

export type DocsNavGroup = {
  title: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: 'Get started',
    items: [
      { href: '/installation', label: 'Installation' },
      { href: '/docs/authentication', label: 'Authentication' },
      { href: '/api-reference', label: 'OpenAPI reference' },
      { href: '/cli', label: 'CLI' },
    ],
  },
  {
    title: 'Core API',
    items: [
      { href: '/docs/api', label: 'API guide' },
      { href: '/docs/returns-decomposition-metrics', label: 'Returns decomposition' },
      { href: '/docs/rankings-screen', label: 'Rankings screen' },
      { href: '/docs/batch-lstar', label: 'Batch Lstar' },
      { href: '/docs/industry-panel', label: 'Industry panel' },
      { href: '/docs/etf-factor-returns', label: 'ETF factor returns' },
      { href: '/docs/universe-members', label: 'Universe members' },
      { href: '/docs/residual-signal-basket', label: 'Residual signal basket' },
      { href: '/docs/macro-factors', label: 'Factor correlation' },
      { href: '/docs/fundamentals', label: 'Fundamentals' },
      { href: '/docs/response-metadata', label: 'Response metadata' },
    ],
  },
  {
    title: 'Methodology & engine',
    items: [
      { href: '/docs/methodology', label: 'Methodology' },
      { href: '/docs/erm3-engine', label: 'ERM3 engine' },
    ],
  },
  {
    title: 'Agents',
    items: [
      { href: '/for-agents', label: 'For agents' },
      { href: '/docs/agent-integration', label: 'Agent integration' },
      { href: '/llms.txt', label: 'llms.txt', external: true },
    ],
  },
  {
    title: 'Account & data',
    items: [{ href: '/docs/plaid-holdings', label: 'Plaid holdings' }],
  },
];

/** Slugs referenced by the sidebar, i.e. every /docs/<slug> link. Used by the
 *  build-time coverage check so a new MDX page can't go unlisted. */
export function docsNavSlugs(): string[] {
  const slugs: string[] = [];
  for (const group of DOCS_NAV) {
    for (const item of group.items) {
      const match = item.href.match(/^\/docs\/([^/#?]+)/);
      if (match) slugs.push(match[1]);
    }
  }
  return slugs;
}
