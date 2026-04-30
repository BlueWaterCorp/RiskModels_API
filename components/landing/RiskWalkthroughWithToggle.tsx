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
    <div className="border-b border-zinc-800/80 bg-zinc-950 pt-10">
      <RiskWalkthroughChart
        view="both"
        compact
        snapshots={data?.snapshots ?? null}
        tickers={NVDA_FIRST_ORDER}
        defaultTicker="NVDA"
      />
      <p className="mx-auto mt-2 max-w-3xl px-4 pb-8 text-center text-sm leading-relaxed text-zinc-400 sm:px-6 sm:text-base lg:px-8">
        <span className="font-semibold text-emerald-400">Residual</span> is the
        performance of your stock pick — after market, sector, and subsector.
      </p>
    </div>
  );
}
