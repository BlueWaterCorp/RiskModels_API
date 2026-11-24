'use client';

import { useState } from 'react';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

/** Text "Copy" control; reports "Copied" for two seconds after a successful copy. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyTextToClipboard(text).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        });
      }}
      className={`rm-mono shrink-0 rounded-[2px] border border-rule px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-navy hover:text-navy ${className}`}
      title={text.length > 80 ? undefined : text}
    >
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
