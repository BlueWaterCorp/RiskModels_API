import type { ReactNode } from 'react';

/** Numbered section head: mono label stacked above the serif heading, one rhythm on every page. */
export function SectionHead({
  n,
  label,
  title,
  children,
  id,
}: {
  n: string;
  label: string;
  title: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="rm-label">
        {n} · {label}
      </p>
      <h2 id={id} className="rm-h2 mt-3">
        {title}
      </h2>
      {children ? <div className="rm-body mt-3">{children}</div> : null}
    </div>
  );
}
