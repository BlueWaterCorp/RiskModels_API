'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export type PricingFaqItem = { q: string; a: string };

export default function PricingFAQ({ items }: { items: PricingFaqItem[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/25 backdrop-blur-md divide-y divide-zinc-800/80 overflow-hidden max-w-4xl">
      {items.map((item) => {
        const isOpen = openKey === item.q;
        return (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : item.q)}
              className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/30 transition-colors"
              aria-expanded={isOpen}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/60 text-zinc-400 transition-transform duration-200',
                  isOpen && 'rotate-45 text-blue-400 border-blue-500/40'
                )}
                aria-hidden
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
              </span>
              <span className="text-sm font-semibold text-white pt-0.5 pr-2 leading-snug">
                {item.q}
              </span>
            </button>
            {isOpen ? (
              <div className="px-4 pb-3 pl-[3.25rem] pr-4 animate-fade-in">
                <p className="text-xs text-zinc-400 leading-snug">{item.a}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
