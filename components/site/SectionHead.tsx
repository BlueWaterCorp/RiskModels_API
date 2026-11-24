import type { ReactNode } from 'react';

/** Numbered section head: mono label in the margin column, serif heading beside it. */
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
    <div className="grid gap-x-8 gap-y-3 lg:grid-cols-12">
      <p className="rm-label lg:col-span-3">
        {n} · {label}
      </p>
      <div className="lg:col-span-9">
        <h2 id={id} className="rm-h2">
          {title}
        </h2>
        {children ? <div className="rm-body mt-3">{children}</div> : null}
      </div>
    </div>
  );
}
