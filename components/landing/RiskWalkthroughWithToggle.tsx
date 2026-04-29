'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { RiskWalkthroughChart } from './RiskWalkthroughChart';

type View = 'performance' | 'risk';

const TOGGLES: { id: View; primary: string; secondary: string }[] = [
  { id: 'risk',        primary: 'Risk',        secondary: 'what you own' },
  { id: 'performance', primary: 'Performance', secondary: 'what happened' },
];

export default function RiskWalkthroughWithToggle() {
  const [view, setView] = useState<View>('risk');

  return (
    <div className="border-b border-zinc-800/80 bg-zinc-950 pt-10">
      <div className="mx-auto flex max-w-5xl justify-center px-4 sm:px-6 lg:px-8">
        <div
          role="tablist"
          aria-label="Decomposition view"
          className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1"
        >
          {TOGGLES.map((t) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(t.id)}
                className={cn(
                  'rounded-md px-4 py-2 text-sm font-semibold transition',
                  active
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <span>{t.primary}</span>
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  — {t.secondary}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <RiskWalkthroughChart view={view} />
    </div>
  );
}
