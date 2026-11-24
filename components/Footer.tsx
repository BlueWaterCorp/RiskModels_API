import Link from 'next/link';
import { EcosystemBar } from './EcosystemBar';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean; prefetch?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/installation', label: 'Quickstart' },
      { href: '/api-reference', label: 'API reference' },
      { href: '/docs/api', label: 'API guide' },
      { href: '/cli', label: 'CLI' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Agents and data',
    links: [
      { href: '/for-agents', label: 'For agents' },
      { href: '/docs/agent-integration', label: 'Connector setup' },
      { href: '/llms.txt', label: 'llms.txt', prefetch: false },
      { href: '/security-master-feed', label: 'Event feed' },
      { href: '/openapi.json', label: 'OpenAPI file', prefetch: false },
    ],
  },
  {
    title: 'Operations',
    links: [
      { href: '/status', label: 'Status' },
      { href: '/docs/changelog', label: 'Changelog' },
      { href: '/docs/methodology', label: 'Methodology' },
      { href: 'https://github.com/BlueWaterCorp/RiskModels_API', label: 'GitHub', external: true },
      { href: 'mailto:service@riskmodels.app', label: 'Contact', external: true },
    ],
  },
  {
    title: 'Terms',
    links: [
      { href: '/legal', label: 'Legal and disclosures' },
      { href: '/legal/feed-terms', label: 'Feed terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/compare/barra-axioma', label: 'Model comparison' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="w-full border-t border-rule bg-background">
      <div className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title} className="min-w-0">
              <p className="rm-label">{col.title}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l) =>
                  l.external ? (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        className="text-ink-muted hover:text-ink"
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.href}>
                      <Link href={l.href} prefetch={l.prefetch} className="text-ink-muted hover:text-ink">
                        {l.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-rule pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-ink-muted">
            &copy; {new Date().getFullYear()} Blue Water Macro Corp. RiskModels is a registered DBA of Blue Water
            Macro Corp. End-of-day historical data; not investment advice.
          </p>
          <EcosystemBar current="app" />
        </div>
      </div>
    </footer>
  );
}
