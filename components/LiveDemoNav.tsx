'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles, Copy, Check, ChevronDown } from 'lucide-react';

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_API_KEY ?? '';

export default function LiveDemoNav() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const copyKey = async () => {
    if (!DEMO_KEY) return;
    await navigator.clipboard.writeText(DEMO_KEY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!DEMO_KEY) {
    return (
      <Link
        href="/quickstart"
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 shadow-sm shadow-amber-950/20 transition-colors hover:border-amber-400/50 hover:bg-amber-500/15"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Live Demo
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 shadow-sm shadow-amber-950/20 transition-colors hover:border-amber-400/50 hover:bg-amber-500/15"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Live Demo
        <ChevronDown
          className={`h-3.5 w-3.5 text-amber-400/80 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-xl shadow-black/40 ring-1 ring-white/[0.06] backdrop-blur-md"
          role="dialog"
          aria-label="Public demo API key"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Public demo key</p>
          <p className="mt-1 text-xs text-zinc-400">
            MAG7-only, rate limited. Paste into{' '}
            <code className="rounded bg-zinc-900 px-1 text-zinc-300">RISKMODELS_API_KEY</code> or try the quickstart.
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
          <Link
            href="/quickstart"
            className="mt-3 block text-center text-xs font-semibold text-primary hover:text-primary/80"
            onClick={() => setOpen(false)}
          >
            Open Quickstart →
          </Link>
        </div>
      )}
    </div>
  );
}
