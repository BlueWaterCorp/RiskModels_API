'use client';

import { useEffect, useState } from 'react';
import {
  RiskWalkthroughChart,
  type RiskWalkthroughSnapshot,
} from './RiskWalkthroughChart';

interface Mag7Payload {
  tickers: string[];
  snapshots: Record<string, RiskWalkthroughSnapshot>;
}

const NVDA_FIRST_ORDER = ['NVDA', 'AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'TSLA'];

export default function RiskWalkthroughWithToggle() {
  const [data, setData] = useState<Mag7Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/landing/mag7-hero', { method: 'GET' })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: Mag7Payload | null) => {
        if (!cancelled && payload) setData(payload);
      })
      .catch(() => {
        // Silent fall-through to demo snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border-b border-zinc-800/80 bg-zinc-950 pt-10 sm:pt-12">
      <div className="mx-auto max-w-3xl px-4 pb-3 text-center sm:px-6 lg:px-8">
        <p className="text-3xl font-semibold leading-tight text-zinc-200 sm:text-4xl">
          Market beta got you here.
        </p>
        <p className="mt-1 text-3xl font-semibold leading-tight text-white sm:text-4xl">
          This shows what actually did.
        </p>
      </div>

      <RiskWalkthroughChart
        view="both"
        compact
        snapshots={data?.snapshots ?? null}
        tickers={NVDA_FIRST_ORDER}
        defaultTicker="NVDA"
      />

      <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6 lg:px-8">
        <p className="mt-6 text-center text-lg leading-relaxed text-zinc-200 sm:text-xl">
          <span className="font-semibold text-emerald-400">Residual</span> is what your stock pick actually did.
        </p>
        <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500 sm:text-sm">
          <span className="text-zinc-300">Market</span> · <span className="text-zinc-300">Sector</span> · <span className="text-zinc-300">Subsector</span> → exposures (<span className="font-mono">_HR</span> available)
          <span className="mx-2 text-zinc-700">|</span>
          <span className="text-emerald-400">Residual</span> → what remains (<span className="font-mono">_HR</span> = none)
        </p>
      </div>
    </section>
  );
}
