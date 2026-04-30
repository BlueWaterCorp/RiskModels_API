import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Public-side affiliate helper for riskmodels.app.
 *
 * Scope is deliberately narrow: lookup-by-code only. Revenue aggregation, payouts, and
 * commission math live in BWMACRO (admin/private) — this file should never grow those
 * concerns even if it's tempting.
 */

export type AffiliateLookup = {
  id: string;
  referral_code: string;
};

/**
 * Hard cap for any referral_code value coming from a request body. Real codes are short
 * (3–40 chars per BWMACRO's create form). Anything beyond this is either a typo or an
 * adversarial payload and is rejected before we hit the DB.
 */
export const MAX_REFERRAL_CODE_LEN = 64;

/**
 * Resolve a referral code to an active affiliate. Returns null if the code is missing,
 * malformed, over-length, unknown, or attached to a non-active affiliate.
 */
export async function findActiveAffiliateByCode(
  admin: SupabaseClient,
  referralCode: string | null | undefined,
): Promise<AffiliateLookup | null> {
  if (!referralCode || typeof referralCode !== 'string') return null;
  const code = referralCode.trim();
  if (!code || code.length > MAX_REFERRAL_CODE_LEN) return null;

  const { data, error } = await admin
    .from('affiliates')
    .select('id, referral_code, status')
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status && data.status !== 'active') return null;
  return { id: data.id as string, referral_code: data.referral_code as string };
}

/** Default rate when the affiliate row's commission_rate is null. Mirrors BWMACRO. */
export const DEFAULT_COMMISSION_RATE = 0.2;

export type SelfServeAffiliate = {
  id: string;
  referral_code: string;
  status: string;
  commission_rate: number;
  payout_email: string | null;
  stats: {
    referred_key_count: number;
    referred_user_count: number;
    total_revenue_usd: number;
    commission_earned_usd: number;
    total_paid_out_usd: number;
    balance_owed_usd: number;
  };
};

/**
 * Self-serve dashboard data: returns the affiliate row attached to the given user_id, plus
 * stats. Returns null if the user isn't an affiliate. Read-only — no mutation, no admin
 * surface area; safe to expose at /api/affiliate/me.
 */
export async function getStatsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<SelfServeAffiliate | null> {
  const { data: affRow } = await admin
    .from('affiliates')
    .select('id, referral_code, commission_rate, status, payout_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (!affRow) return null;
  const affiliateId = affRow.id as string;
  const rate =
    affRow.commission_rate === null || affRow.commission_rate === undefined
      ? DEFAULT_COMMISSION_RATE
      : Number(affRow.commission_rate);

  /** Referred keys -> distinct referred users -> total spend by those users. */
  const { data: keyRows } = await admin
    .from('agent_api_keys')
    .select('user_id')
    .eq('referred_by_affiliate_id', affiliateId);
  const keyUserIds = ((keyRows ?? []) as { user_id: string | null }[])
    .map((k) => k.user_id)
    .filter(Boolean) as string[];
  const distinctUserIds = [...new Set(keyUserIds)];

  let totalRevenueUsd = 0;
  if (distinctUserIds.length > 0) {
    const { data: spendRows } = await admin
      .from('billing_events')
      .select('cost_usd')
      .in('user_id', distinctUserIds)
      .eq('type', 'debit');
    for (const row of spendRows ?? []) {
      totalRevenueUsd += parseFloat(String((row as { cost_usd: unknown }).cost_usd)) || 0;
    }
  }
  const commissionEarnedUsd = Math.max(0, totalRevenueUsd * rate);

  const { data: payoutRows } = await admin
    .from('affiliate_payouts')
    .select('commission_amount, status')
    .eq('affiliate_id', affiliateId);
  let totalPaidOutUsd = 0;
  for (const row of payoutRows ?? []) {
    const r = row as { commission_amount: unknown; status: unknown };
    if (r.status === 'paid') {
      totalPaidOutUsd += parseFloat(String(r.commission_amount)) || 0;
    }
  }

  return {
    id: affiliateId,
    referral_code: affRow.referral_code as string,
    status: (affRow.status as string) ?? 'active',
    commission_rate: rate,
    payout_email: (affRow.payout_email as string) ?? null,
    stats: {
      referred_key_count: keyUserIds.length,
      referred_user_count: distinctUserIds.length,
      total_revenue_usd: totalRevenueUsd,
      commission_earned_usd: commissionEarnedUsd,
      total_paid_out_usd: totalPaidOutUsd,
      balance_owed_usd: Math.max(0, commissionEarnedUsd - totalPaidOutUsd),
    },
  };
}
