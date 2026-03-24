'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Fuse from 'fuse.js';
import { Search } from 'lucide-react';
import { PORTAL_SEARCH_INDEX } from '@/lib/portal-search-index';

const fuse = new Fuse(PORTAL_SEARCH_INDEX, {
  keys: [
    { name: 'title', weight: 0.45 },
    { name: 'description', weight: 0.35 },
    { name: 'keywords', weight: 0.2 },
  ],
  threshold: 0.42,
  ignoreLocation: true,
  includeScore: true,
});

export default function PortalSearch({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const t = q.trim();
    if (!t) return PORTAL_SEARCH_INDEX.slice(0, 8);
    return fuse.search(t, { limit: 10 }).map((r) => r.item);
  }, [q]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setActive(0);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [router, close]
  );

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      role="combobox"
      aria-expanded={open}
      aria-controls="portal-search-results"
      aria-haspopup="listbox"
    >
      <div
        className={[
          'flex items-center gap-2 rounded-lg border bg-zinc-900/80 px-3 py-2 transition-colors',
          open ? 'border-primary/50 ring-1 ring-primary/20' : 'border-zinc-800 hover:border-zinc-700',
        ].join(' ')}
      >
        <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
              inputRef.current?.blur();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              go(results[active].href);
            }
          }}
          placeholder="Search docs & pages…"
          aria-autocomplete="list"
          aria-controls="portal-search-results"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
        />
        <kbd className="hidden sm:inline-flex shrink-0 items-center gap-0.5 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          ⌘K
        </kbd>
      </div>

      {open && results.length > 0 && (
        <div
          id="portal-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-[60] mt-2 max-h-[min(70vh,22rem)] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/95 py-1 shadow-xl shadow-black/40 ring-1 ring-white/[0.06] backdrop-blur-md"
        >
          {results.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              role="option"
              aria-selected={i === active}
              className={[
                'block px-3 py-2.5 text-left transition-colors',
                i === active ? 'bg-zinc-800/90' : 'hover:bg-zinc-800/60',
              ].join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => close()}
            >
              <span className="block text-sm font-semibold text-zinc-100">{item.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-zinc-500 line-clamp-2">
                {item.description}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
