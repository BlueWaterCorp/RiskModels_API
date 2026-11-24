'use client';

import { useState } from 'react';
import { CopyButton } from './CopyButton';

export interface CodeTab {
  id: string;
  label: string;
  code: string;
  /** Shown under the block; say what the snippet needs and what it costs. */
  note?: string;
}

/** Tabbed, copyable code on a ruled plate. No syntax colour, no window chrome. */
export function CodeExhibit({ tabs, caption }: { tabs: CodeTab[]; caption?: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  return (
    <figure className="rm-plate min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label={caption ?? 'Example'} className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={t.id === tab.id}
                onClick={() => setActive(t.id)}
                className={`rm-label !tracking-[0.1em] ${
                  t.id === tab.id ? '!text-navy underline decoration-navy underline-offset-[6px]' : 'hover:!text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="rm-label">{caption ?? tab.label}</span>
        )}
        <CopyButton text={tab.code} />
      </div>
      <pre className="rm-code px-3 py-3 sm:px-4">
        <code>{tab.code}</code>
      </pre>
      {tab.note ? (
        <figcaption className="rm-small border-t border-rule px-3 py-2 sm:px-4">{tab.note}</figcaption>
      ) : null}
    </figure>
  );
}
