'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Compact one-liner + copy control for MDX tables (e.g. Core Endpoints). */
export default function CopyPythonSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-md border border-zinc-800 bg-zinc-950/90 p-2.5 pr-[5.5rem]">
      <pre className="m-0 max-h-32 overflow-y-auto text-[11px] leading-snug text-zinc-300 whitespace-pre-wrap break-all font-mono">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-[10px] font-medium text-zinc-200 shadow-sm hover:border-zinc-600 hover:bg-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label="Copy Python snippet"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-400" aria-hidden />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" aria-hidden />
            Copy Python
          </>
        )}
      </button>
    </div>
  );
}
