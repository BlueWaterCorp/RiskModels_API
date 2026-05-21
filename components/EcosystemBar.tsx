export type EcosystemSite = 'org' | 'net' | 'app';

const SITES: { id: EcosystemSite; label: string; href: string }[] = [
  { id: 'org', label: 'Research', href: 'https://riskmodels.org' },
  { id: 'net', label: 'Workspace', href: 'https://riskmodels.net' },
  { id: 'app', label: 'API', href: 'https://riskmodels.app' },
];

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
      <span className="uppercase tracking-[0.2em] text-zinc-600">RiskModels</span>
      {SITES.map((s, i) => (
        <span key={s.id} className="inline-flex items-center gap-3">
          {i > 0 ? (
            <span aria-hidden className="text-zinc-700">
              /
            </span>
          ) : null}
          {s.id === current ? (
            <span className="text-zinc-300" aria-current="page">
              {s.label}
            </span>
          ) : (
            <a
              href={s.href}
              className="text-zinc-400 transition-colors hover:text-zinc-100"
            >
              {s.label}
            </a>
          )}
        </span>
      ))}
    </div>
  );
}
