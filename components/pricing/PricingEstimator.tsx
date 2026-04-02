'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

/** Weighted typical average for baseline-style calls (metrics, macro, returns mix). */
const BASELINE_AVG_COST_USD = 0.002;
/** Weighted typical average for premium-style calls (L3, PRI, batch mix). */
const PREMIUM_AVG_COST_USD = 0.025;

function formatUsd(n: number) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PricingEstimator() {
  const [baselineMonthly, setBaselineMonthly] = useState(5000);
  const [premiumMonthly, setPremiumMonthly] = useState(500);

  const { baselineCost, premiumCost, totalCost } = useMemo(() => {
    const b = baselineMonthly * BASELINE_AVG_COST_USD;
    const p = premiumMonthly * PREMIUM_AVG_COST_USD;
    return { baselineCost: b, premiumCost: p, totalCost: b + p };
  }, [baselineMonthly, premiumMonthly]);

  return (
    <div
      className={cn(
        'rounded-xl border border-blue-500/25 bg-zinc-900/35 backdrop-blur-md p-4 sm:p-5',
        'shadow-[0_0_40px_-12px_rgba(59,130,246,0.35)]'
      )}
    >
      <div className="flex flex-col gap-0.5 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
          Baseline vs Premium
        </p>
        <h3 className="text-lg font-bold text-white tracking-tight">
          Model your monthly spend
        </h3>
        <p className="text-xs text-zinc-300 max-w-2xl leading-snug">
          Baseline features ($0.001–$0.005/call) power everyday risk checks and time series. Premium
          capabilities unlock deeper L3 decomposition, portfolio-level risk indexing, PDF snapshots,
          and batch analytics — perfect for agents and power users.
        </p>
        <p className="text-xs text-zinc-500 max-w-2xl leading-snug">
          Slide request volumes by tier. Averages (
          <span className="font-mono text-zinc-300">{formatUsd(BASELINE_AVG_COST_USD)}</span> baseline,{' '}
          <span className="font-mono text-zinc-300">{formatUsd(PREMIUM_AVG_COST_USD)}</span> premium)
          approximate a typical mix — use the tables below for exact per-endpoint prices.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="pricing-baseline-requests"
              className="flex items-baseline justify-between text-xs font-medium text-zinc-300 mb-1"
            >
              <span>Baseline requests / month</span>
              <span className="font-mono text-blue-400 tabular-nums">
                {baselineMonthly.toLocaleString()}
              </span>
            </label>
            <input
              id="pricing-baseline-requests"
              type="range"
              min={100}
              max={100000}
              step={100}
              value={baselineMonthly}
              onChange={(e) => setBaselineMonthly(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-zinc-800 accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5 font-mono">
              <span>100</span>
              <span>100k</span>
            </div>
          </div>

          <div>
            <label
              htmlFor="pricing-premium-requests"
              className="flex items-baseline justify-between text-xs font-medium text-zinc-300 mb-1"
            >
              <span>Premium requests / month</span>
              <span className="font-mono text-blue-400 tabular-nums">
                {premiumMonthly.toLocaleString()}
              </span>
            </label>
            <input
              id="pricing-premium-requests"
              type="range"
              min={0}
              max={10000}
              step={10}
              value={premiumMonthly}
              onChange={(e) => setPremiumMonthly(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-zinc-800 accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5 font-mono">
              <span>0</span>
              <span>10k</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-lg border border-zinc-800/80 bg-zinc-950/50 backdrop-blur-sm p-4 min-h-[140px]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            Estimated monthly cost
          </p>
          <p className="text-3xl sm:text-4xl font-bold text-white tabular-nums tracking-tight mb-2">
            {formatUsd(totalCost)}
          </p>
          <ul className="text-xs text-zinc-400 space-y-0.5 mb-2">
            <li className="flex justify-between gap-2">
              <span>Baseline ({baselineMonthly.toLocaleString()} × avg)</span>
              <span className="font-mono text-zinc-300 tabular-nums">{formatUsd(baselineCost)}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Premium ({premiumMonthly.toLocaleString()} × avg)</span>
              <span className="font-mono text-zinc-300 tabular-nums">{formatUsd(premiumCost)}</span>
            </li>
          </ul>
          <p className="text-[11px] text-zinc-600 leading-snug border-t border-zinc-800/80 pt-2">
            ({baselineMonthly.toLocaleString()} baseline × {formatUsd(BASELINE_AVG_COST_USD)} avg) + (
            {premiumMonthly.toLocaleString()} premium × {formatUsd(PREMIUM_AVG_COST_USD)} avg). Your
            first $20 in credits are free after card setup.
          </p>
        </div>
      </div>
    </div>
  );
}
