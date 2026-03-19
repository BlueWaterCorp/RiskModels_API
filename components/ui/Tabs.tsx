'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

interface Tab {
  value: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultValue?: string;
  className?: string;
}

export function Tabs({ tabs, defaultValue, className }: TabsProps) {
  const [active, setActive] = useState(defaultValue ?? tabs[0]?.value ?? '');
  const activeTab = tabs.find((t) => t.value === active) ?? tabs[0];

  return (
    <div className={className}>
      <div className="inline-flex rounded-lg bg-zinc-900/80 p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            onClick={() => setActive(tab.value)}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              active === tab.value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4" role="tabpanel">
        {activeTab?.content}
      </div>
    </div>
  );
}
