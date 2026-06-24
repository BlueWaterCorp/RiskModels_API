'use client';

import { useState } from 'react';

/**
 * Minimal inline "Copy" control for the agent-integration MDX boxes.
 * Replaces hand-written `<button onclick="...">` handlers, which React strips
 * when MDX is rendered (lowercase `onclick` is not a real React handler), so
 * the buttons were inert and copied nothing — the user pasted whatever was
 * already on their clipboard. This copies the exact `value` shown in the box.
 */
export default function CopyInline({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-4 text-xs text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0"
      aria-label="Copy to clipboard"
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}
