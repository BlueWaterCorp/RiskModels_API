export type EcosystemSite = 'org' | 'net' | 'app';

const SITES: { id: EcosystemSite; label: string; href: string }[] = [
  { id: 'org', label: 'Research', href: 'https://riskmodels.org' },
  { id: 'net', label: 'Workspace', href: 'https://riskmodels.net' },
  { id: 'app', label: 'API', href: 'https://riskmodels.app' },
];

/** Cross-site UTM tags so .org/.net/.app traffic is attributable (Q.14 phase 2). */
function withUtm(href: string, from: EcosystemSite): string {
  return `${href}?utm_source=riskmodels-${from}&utm_medium=ecosystem-bar&utm_campaign=cross-site`;
}

/**
 * Cross-site ecosystem strip (MASTER_BACKLOG Q.14) — the same three-link
 * element on riskmodels .org / .net / .app, current site marked. Keeps the
 * three properties legible as one linked product group.
 */
export function EcosystemBar({
  current,
  className = '',
}: {
  current: EcosystemSite;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${className}`}
      aria-label="RiskModels ecosystem"
    >
      <span className="uppercase tracking-[0.2em] text-ink-muted">RiskModels</span>
      {SITES.map((s, i) => (
        <span key={s.id} className="inline-flex items-center gap-3">
          {i > 0 ? (
            <span aria-hidden className="text-ink-muted">
              /
            </span>
          ) : null}
          {s.id === current ? (
            <span className="font-semibold text-ink" aria-current="page">
              {s.label}
            </span>
          ) : (
            <a
              href={withUtm(s.href, current)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted transition-colors hover:text-ink"
            >
              {s.label}
            </a>
          )}
        </span>
      ))}
    </div>
  );
}
