'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

/** $20 per 1M tokens */
const USD_PER_MILLION_TOKENS = 20;

const USE_CASES = [
  {
    id: 'simple',
    label: 'Simple metrics & lookups',
    description: 'Light endpoints (e.g. ticker returns, single-field metrics).',
    tokensPerRequest: 250,
  },
  {
    id: 'mixed',
    label: 'Mixed workflows',
    description: 'Typical mix of metrics calls and heavier factor reads.',
    tokensPerRequest: 375,
  },
  {
    id: 'full',
    label: 'Full portfolio analysis',
    description: 'Full risk decomposition, batch-style analysis per request.',
    tokensPerRequest: 500,
  },
] as const;

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
  const [monthlyRequests, setMonthlyRequests] = useState(5000);
  const [useCaseId, setUseCaseId] = useState<(typeof USE_CASES)[number]['id']>('mixed');

  const useCase = USE_CASES.find((u) => u.id === useCaseId) ?? USE_CASES[1];

  const { estimatedTokens, estimatedCost } = useMemo(() => {
    const tokens = monthlyRequests * useCase.tokensPerRequest;
    const cost = (tokens / 1_000_000) * USD_PER_MILLION_TOKENS;
    return { estimatedTokens: tokens, estimatedCost: cost };
  }, [monthlyRequests, useCase.tokensPerRequest]);

  return (
    <div
      className={cn(
        'rounded-xl border border-blue-500/25 bg-zinc-900/35 backdrop-blur-md p-4 sm:p-5',
        'shadow-[0_0_40px_-12px_rgba(59,130,246,0.35)]'
      )}
    >
      <div className="flex flex-col gap-0.5 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
          Pricing estimator
        </p>
        <h3 className="text-lg font-bold text-white tracking-tight">
          Model your monthly spend
        </h3>
        <p className="text-xs text-zinc-400 max-w-2xl leading-snug">
          One request maps to a token count by use case. We use{' '}
          <span className="text-zinc-300 font-medium">$20 per 1M tokens</span> — same as the table
          below.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="space-y-3">
          <div>
            <label
              htmlFor="pricing-monthly-requests"
              className="flex items-baseline justify-between text-xs font-medium text-zinc-300 mb-1"
            >
              <span>Monthly requests</span>
              <span className="font-mono text-blue-400 tabular-nums">
                {monthlyRequests.toLocaleString()}
              </span>
            </label>
            <input
              id="pricing-monthly-requests"
              type="range"
              min={100}
              max={100000}
              step={100}
              value={monthlyRequests}
              onChange={(e) => setMonthlyRequests(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-zinc-800 accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5 font-mono">
              <span>100</span>
              <span>100k</span>
            </div>
          </div>

          <div>
            <label htmlFor="pricing-use-case" className="block text-xs font-medium text-zinc-300 mb-1">
              Primary use case
            </label>
            <select
              id="pricing-use-case"
              value={useCaseId}
              onChange={(e) =>
                setUseCaseId(e.target.value as (typeof USE_CASES)[number]['id'])
              }
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
            >
              {USE_CASES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
              {useCase.description}{" "}
              <span className="text-zinc-600">
                (1 request ={" "}
                <span className="font-mono text-zinc-400">{useCase.tokensPerRequest}</span> tokens.)
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-lg border border-zinc-800/80 bg-zinc-950/50 backdrop-blur-sm p-4 min-h-[140px]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
            Estimated monthly cost
          </p>
          <p className="text-3xl sm:text-4xl font-bold text-white tabular-nums tracking-tight mb-0.5">
            {formatUsd(estimatedCost)}
          </p>
          <p className="text-xs text-zinc-400 mb-2">
            ≈{' '}
            <span className="font-mono text-zinc-300">
              {estimatedTokens.toLocaleString()}
            </span>{' '}
            tokens / month
          </p>
          <p className="text-[11px] text-zinc-600 leading-snug border-t border-zinc-800/80 pt-2">
            Formula: ({monthlyRequests.toLocaleString()} requests × {useCase.tokensPerRequest} tokens)
            ÷ 1M × ${USD_PER_MILLION_TOKENS}. Your first $20 in credits are free after card setup.
          </p>
        </div>
      </div>
    </div>
  );
}
