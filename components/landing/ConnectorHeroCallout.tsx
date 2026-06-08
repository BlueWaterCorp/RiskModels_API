'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

const MCP_URL = 'https://riskmodels.app/api/mcp/sse';

/**
 * Hero callout for the no-terminal MCP OAuth connector. Paste the URL into
 * Claude / Cursor's "Add custom connector", sign in once, done — no API key.
 */
export default function ConnectorHeroCallout() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyTextToClipboard(MCP_URL).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  return (
    <div className="mx-auto mt-8 max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        Add to Claude or Cursor · no terminal, no API key
      </p>
      <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2">
        <code className="flex-1 truncate font-mono text-[13px] text-zinc-200">{MCP_URL}</code>
        <button
          onClick={copy}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 font-mono text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
          aria-label="Copy connector URL"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-zinc-500">
        Settings → Connectors → Add custom connector → paste → Connect. Sign in once and approve; the
        tools load automatically.{' '}
        <Link href="/docs/agent-integration" className="text-emerald-400 hover:underline">
          Setup guide →
        </Link>
      </p>
    </div>
  );
}
