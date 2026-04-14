'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Activity, AlertCircle, CreditCard, DollarSign, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type UsageData = {
  balance: number;
  monthly_spend_cap: number | null;
  monthly_spend_usd: number;
  this_month: {
    total_calls: number;
    total_spend: number;
    avg_cost_per_call: number;
    from_date: string;
    to_date: string;
  };
  capability_breakdown: Array<{ capability_id: string; calls: number; spend: number }>;
};

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

export default function UsagePage() {
  const router = useRouter();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setAccountEmail(null);
    router.refresh();
    setUnauthorized(true);
    setData(null);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function fetchUsage() {
      setLoading(true);
      setError(null);
      setUnauthorized(false);
      try {
        const res = await fetch('/api/usage');
        if (res.status === 401) {
          if (!cancelled) {
            setUnauthorized(true);
            setData(null);
            setAccountEmail(null);
          }
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body.error === 'string' ? body.error : 'Failed to load usage data',
          );
        }
        const json = (await res.json()) as UsageData;
        if (!cancelled) {
          setData(json);
          const supabase = createClient();
          const { data: u } = await supabase.auth.getUser();
          setAccountEmail(u.user?.email ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load usage data');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUsage();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="min-h-screen bg-zinc-950 py-16 px-4">
        <div className="max-w-lg mx-auto rounded-xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex items-center gap-2 text-amber-400 mb-3">
            <AlertCircle size={20} />
            <h1 className="text-lg font-semibold text-zinc-100">Sign in required</h1>
          </div>
          <p className="text-sm text-zinc-400 mb-6">
            Sign in to view API usage and spend for your account.
          </p>
          <Link
            href="/get-key"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            Get API key / Sign in
          </Link>
          <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
            Sign in via{' '}
            <Link href="/get-key" className="text-primary hover:underline">
              Get API key
            </Link>
            , then return here for usage. After sign-in, create or copy your key under{' '}
            <span className="text-zinc-400">Account → Usage</span>. See{' '}
            <Link href="/docs/authentication" className="text-primary hover:underline">
              Authentication
            </Link>{' '}
            for scopes and billing details.
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 py-16 px-4">
        <div className="max-w-lg mx-auto rounded-xl border border-red-800/40 bg-red-950/20 p-8">
          <div className="flex items-center gap-2 text-red-400 mb-3">
            <AlertCircle size={20} />
            <h1 className="text-lg font-semibold text-zinc-100">Error</h1>
          </div>
          <p className="text-sm text-zinc-400 mb-6">{error || 'Could not load usage data'}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg border border-zinc-700 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const capLabel =
    data.monthly_spend_cap != null
      ? `${formatUsd(data.monthly_spend_usd)} / ${formatUsd(data.monthly_spend_cap)} this cycle`
      : 'No monthly cap set';

  return (
    <div className="min-h-screen bg-zinc-950 py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Usage &amp; spend</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Balance and billable API activity this month (debit events).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end sm:pt-0.5 flex-shrink-0">
            {accountEmail && (
              <span className="text-xs text-zinc-500 truncate max-w-[min(100%,20rem)]" title={accountEmail}>
                {accountEmail}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 mb-8">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Summary</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-5">
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
                <CreditCard size={16} />
                Balance
              </div>
              <div className="text-2xl font-bold text-zinc-100">{formatUsd(data.balance)}</div>
              <p className="text-xs text-zinc-500 mt-2">{capLabel}</p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-5">
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
                <DollarSign size={16} />
                This month (spend)
              </div>
              <div className="text-2xl font-bold text-zinc-100">
                {formatUsd(data.this_month.total_spend)}
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                {data.this_month.from_date} – {data.this_month.to_date}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-5">
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
                <Activity size={16} />
                API calls
              </div>
              <div className="text-2xl font-bold text-zinc-100">
                {data.this_month.total_calls.toLocaleString()}
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                Avg {formatUsd(data.this_month.avg_cost_per_call)} / call
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 mb-8">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">By capability</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.capability_breakdown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-zinc-500 py-10">
                    No billable API calls this month
                  </TableCell>
                </TableRow>
              ) : (
                data.capability_breakdown.map((row) => (
                  <TableRow key={row.capability_id}>
                    <TableCell className="font-mono text-sm text-zinc-200">
                      {row.capability_id}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.calls.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(row.spend)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/get-key"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            Manage billing / add funds
          </Link>
          <Link
            href="/get-key"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-zinc-700 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Back to API keys
          </Link>
        </div>
      </div>
    </div>
  );
}
