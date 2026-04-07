'use client';

import { useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_API_KEY ?? '';

export default function QuickstartDemoKey() {
  const [copied, setCopied] = useState(false);

  if (!DEMO_KEY) return null;

  const copyKey = () => {
    void copyTextToClipboard(DEMO_KEY).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  return (
    <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 shadow-sm shadow-amber-950/20 ring-1 ring-amber-500/15">
      <div className="flex items-center gap-2 text-amber-200">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
        <p className="text-sm font-semibold">Try first — public demo key</p>
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        MAG7-only, rate limited. Paste into{' '}
        <code className="rounded bg-zinc-900 px-1 text-zinc-300">RISKMODELS_API_KEY</code> for the examples below.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-700/40 bg-zinc-900/80 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-400">{DEMO_KEY}</code>
        <button
          type="button"
          onClick={copyKey}
          className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:border-zinc-600 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden />
              Copy
            </>
          )}
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">For full universe access and billing, sign up and use your own key.</p>
    </div>
  );
}
