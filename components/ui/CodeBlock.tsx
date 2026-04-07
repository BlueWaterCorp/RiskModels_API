'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { BundledLanguage, Highlighter } from 'shiki';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

interface CodeBlockProps {
  code: string;
  language?: BundledLanguage;
  className?: string;
  showCopy?: boolean;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter, createJavaScriptRegexEngine } = await import('shiki');
      return createHighlighter({
        themes: ['github-dark'],
        langs: ['json', 'http'],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

function inferLanguage(code: string, explicit?: BundledLanguage): BundledLanguage {
  if (explicit) return explicit;
  const t = code.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  return 'http';
}

/** Bold JSON property key `"_agent"` when it is immediately followed by `:`. */
function emphasizeAgentKeyInJsonHtml(html: string): string {
  return html.replace(
    /<span([^>]*)>("_agent")<\/span>(<span[^>]*>\s*:)/g,
    '<span$1><strong class="font-bold text-primary">$2</strong></span>$3'
  );
}

export function CodeBlock({ code, language, className, showCopy = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  const lang = inferLanguage(code, language);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hl = await getHighlighter();
        const raw = hl.codeToHtml(code, { lang, theme: 'github-dark' });
        const processed =
          lang === 'json' && code.includes('_agent') ? emphasizeAgentKeyInJsonHtml(raw) : raw;
        if (!cancelled) setHighlightedHtml(processed);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const handleCopy = () => {
    void copyTextToClipboard(code).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  return (
    <div
      className={cn(
        'group relative rounded-lg bg-zinc-900/90 ring-1 ring-zinc-800/80',
        className
      )}
    >
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'absolute right-2 top-2 z-10 rounded-md px-2 py-1.5 text-xs font-medium',
            'bg-zinc-800/90 text-zinc-300 ring-1 ring-zinc-700/80 shadow-sm',
            'opacity-100 transition-opacity duration-200',
            'hover:bg-zinc-700 hover:text-white',
            'md:pointer-events-auto md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
          )}
          aria-label="Copy code"
        >
          <span className="flex items-center gap-1.5">
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy
              </>
            )}
          </span>
        </button>
      )}
      {highlightedHtml ? (
        <div
          className={cn(
            'overflow-x-auto p-4 pr-14 text-sm font-mono tabular-nums leading-relaxed text-zinc-300',
            '[&_pre.shiki]:m-0 [&_pre.shiki]:!bg-transparent [&_pre.shiki]:p-0',
            '[&_pre.shiki]:text-[13px] [&_code]:font-mono'
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 pr-14 text-sm font-mono tabular-nums leading-relaxed text-zinc-300">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
