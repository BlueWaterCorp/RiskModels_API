'use client';

import { useId, useState } from 'react';
import { CopyButton } from './CopyButton';

export interface CodeTab {
  id: string;
  label: string;
  code: string;
  /** Shown under the block; say what the snippet needs and what it costs. */
  note?: string;
}

/** Tabbed, copyable code on a ruled plate. No syntax color, no window chrome.
 *  `collapsedLines` shows that many lines of a long block with a toggle for the
 *  rest, so a tall response can sit beside a short request. Copy always copies
 *  the whole block. */
export function CodeExhibit({
  tabs,
  caption,
  collapsedLines,
}: {
  tabs: CodeTab[];
  caption?: string;
  collapsedLines?: number;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  const lineCount = tab.code.split('\n').length;
  const collapsible = collapsedLines != null && lineCount > collapsedLines + 2;
  const collapsed = collapsible && !expanded;
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
      <div className="relative">
        <pre
          id={panelId}
          className="rm-code px-3 py-3 sm:px-4"
          style={collapsed ? { maxHeight: `calc(${collapsedLines} * 1.5rem + 0.75rem)`, overflow: 'hidden' } : undefined}
        >
          <code>{tab.code}</code>
        </pre>
        {collapsed ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[var(--rm-plate)]"
          />
        ) : null}
      </div>
      {collapsible ? (
        <div className="border-t border-rule px-3 py-2 sm:px-4">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={panelId}
            onClick={() => setExpanded((v) => !v)}
            className="rm-mono text-[12px] text-navy underline underline-offset-4 hover:text-ink"
          >
            {collapsed ? `Show full response (${lineCount} lines)` : 'Show less'}
          </button>
        </div>
      ) : null}
      {tab.note ? (
        <figcaption className="rm-small border-t border-rule px-3 py-2 sm:px-4">{tab.note}</figcaption>
      ) : null}
    </figure>
  );
}
