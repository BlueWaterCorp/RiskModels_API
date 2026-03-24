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
        'rounded-2xl border border-blue-500/25 bg-zinc-900/35 backdrop-blur-md p-6 sm:p-8',
        'shadow-[0_0_40px_-12px_rgba(59,130,246,0.35)]'
      )}
    >
      <div className="flex flex-col gap-1 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">
          Pricing estimator
        </p>
        <h3 className="text-xl font-bold text-white tracking-tight">
          Model your monthly spend
        </h3>
        <p className="text-sm text-zinc-400 max-w-2xl">
          One request maps to a token count by use case. We use{' '}
          <span className="text-zinc-300 font-medium">$20 per 1M tokens</span> — same as the table
          below.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="space-y-5">
          <div>
            <label
              htmlFor="pricing-monthly-requests"
              className="flex items-baseline justify-between text-sm font-medium text-zinc-300 mb-2"
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
            <div className="flex justify-between text-[11px] text-zinc-600 mt-1 font-mono">
              <span>100</span>
              <span>100k</span>
            </div>
          </div>

          <div>
            <label htmlFor="pricing-use-case" className="block text-sm font-medium text-zinc-300 mb-2">
              Primary use case
            </label>
            <select
              id="pricing-use-case"
              value={useCaseId}
              onChange={(e) =>
                setUseCaseId(e.target.value as (typeof USE_CASES)[number]['id'])
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
            >
              {USE_CASES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              {useCase.description}{" "}
              <span className="text-zinc-600">
                (1 request ={" "}
                <span className="font-mono text-zinc-400">{useCase.tokensPerRequest}</span> tokens.)
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/50 backdrop-blur-sm p-6 min-h-[180px]">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">
            Estimated monthly cost
          </p>
          <p className="text-4xl sm:text-5xl font-bold text-white tabular-nums tracking-tight mb-1">
            {formatUsd(estimatedCost)}
          </p>
          <p className="text-sm text-zinc-400 mb-4">
            ≈{' '}
            <span className="font-mono text-zinc-300">
              {estimatedTokens.toLocaleString()}
            </span>{' '}
            tokens / month
          </p>
          <p className="text-xs text-zinc-600 leading-relaxed border-t border-zinc-800/80 pt-4">
            Formula: ({monthlyRequests.toLocaleString()} requests × {useCase.tokensPerRequest} tokens)
            ÷ 1M × ${USD_PER_MILLION_TOKENS}. Your first $20 in credits are free after card setup.
          </p>
        </div>
      </div>
    </div>
  );
}
