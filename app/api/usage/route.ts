import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyChargeDebitFilters } from '@/lib/billing-event-filters';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { error: rpcError } = await admin.rpc('check_reset_monthly_spend', {
    p_user_id: user.id,
  } as { p_user_id: string });
  if (rpcError) {
    console.warn('[Usage API] check_reset_monthly_spend:', rpcError.message);
  }

  const { data: account } = await admin
    .from('agent_accounts')
    .select('balance_usd, monthly_spend_cap, monthly_spend_usd')
    .eq('user_id', user.id)
    .maybeSingle();

  const now = new Date();
  const firstOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const firstOfMonthIso = firstOfMonth.toISOString();

  const { data: usageRows, error: usageError } = await applyChargeDebitFilters(
    admin.from('billing_events').select('created_at, cost_usd, capability_id'),
  )
    .eq('user_id', user.id)
    .gte('created_at', firstOfMonthIso)
    .order('created_at', { ascending: true });

  if (usageError) {
    console.error('[Usage API] billing_events:', usageError.message);
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }

  type UsageRow = {
    created_at: string;
    cost_usd: number | string | null;
    capability_id: string | null;
  };
  const usage = (usageRows ?? []) as UsageRow[];
  const totalCalls = usage.length;
  const totalSpend = usage.reduce((sum: number, row: UsageRow) => {
    const c =
      typeof row.cost_usd === 'number'
        ? row.cost_usd
        : parseFloat(String(row.cost_usd ?? 0));
    return sum + c;
  }, 0);
  const avgCostPerCall = totalCalls > 0 ? totalSpend / totalCalls : 0;

  const capabilityBreakdown: Record<string, { count: number; cost: number }> = {};
  for (const row of usage) {
    const capId = row.capability_id || 'unknown';
    const c =
      typeof row.cost_usd === 'number'
        ? row.cost_usd
        : parseFloat(String(row.cost_usd ?? 0));
    if (!capabilityBreakdown[capId]) {
      capabilityBreakdown[capId] = { count: 0, cost: 0 };
    }
    capabilityBreakdown[capId].count++;
    capabilityBreakdown[capId].cost += c;
  }

  const balance = account ? parseFloat(String(account.balance_usd ?? 0)) : 0;
  const monthly_spend_cap =
    account?.monthly_spend_cap != null
      ? parseFloat(String(account.monthly_spend_cap))
      : null;
  const monthly_spend_usd =
    account?.monthly_spend_usd != null
      ? parseFloat(String(account.monthly_spend_usd))
      : 0;

  return NextResponse.json({
    balance,
    monthly_spend_cap,
    monthly_spend_usd,
    this_month: {
      total_calls: totalCalls,
      total_spend: Number(totalSpend.toFixed(4)),
      avg_cost_per_call: Number(avgCostPerCall.toFixed(6)),
      from_date: firstOfMonthIso.split('T')[0],
      to_date: now.toISOString().split('T')[0],
    },
    capability_breakdown: Object.entries(capabilityBreakdown).map(
      ([capability_id, stats]) => ({
        capability_id,
        calls: stats.count,
        spend: Number(stats.cost.toFixed(4)),
      }),
    ),
  });
}
