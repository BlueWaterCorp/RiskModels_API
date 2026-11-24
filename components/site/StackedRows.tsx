import type { ReactNode } from 'react';

export interface StackedRow {
  key: string;
  title: ReactNode;
  lines: ReactNode[];
}

/** Phone layout for a table: one ruled block per row, shown below the `sm` breakpoint. */
export function StackedRows({
  caption,
  rows,
  className = '',
}: {
  caption?: string;
  rows: StackedRow[];
  className?: string;
}) {
  return (
    <div className={`sm:hidden ${className}`}>
      {caption ? <p className="rm-label pb-3">{caption}</p> : null}
      <ul className="border-t border-[var(--rm-ink)]">
        {rows.map((r) => (
          <li key={r.key} className="border-b border-rule py-3">
            <p className="text-sm leading-snug text-ink">{r.title}</p>
            {r.lines.map((line, i) => (
              <p key={i} className="rm-mono mt-1 break-words text-[0.8125rem] leading-snug text-ink-muted">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
