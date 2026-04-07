'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export default function CodeBlock({ 
  code, 
  language = 'typescript', 
  filename,
  className 
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void copyTextToClipboard(code).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  return (
    <div className={cn('relative group', className)}>
      {/* Header with filename and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-t-lg">
        <div className="flex items-center gap-2">
          {filename && (
            <span className="text-xs text-zinc-400 font-mono">{filename}</span>
          )}
          {!filename && (
            <span className="text-xs text-zinc-500 font-mono">{language}</span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 transition-colors rounded"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} />
              Copied
            </>
          ) : (
            <>
              <Copy size={14} />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre className="overflow-x-auto bg-zinc-950 border-x border-b border-zinc-800 rounded-b-lg p-4">
        <code className="text-sm text-zinc-300 font-mono leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
}
