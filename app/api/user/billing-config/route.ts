/**
 * GET /api/user/billing-config — Current auto-refill preferences (agent_accounts).
 * PATCH /api/user/billing-config — Update auto_top_up, amount, and/or threshold.
 *
 * Refill amounts must be exactly $20, $50, or $100 when provided.
 *
 * Auth: API key, Bearer JWT, or session (see authenticateRequest).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase/auth-helper';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCorsHeaders } from '@/lib/cors';

export const dynamic = 'force-dynamic';

const ALLOWED_REFILL_AMOUNTS = [20.0, 50.0, 100.0] as const;
const MIN_THRESHOLD = 5;
const MAX_THRESHOLD = 50;

function isAllowedRefillAmount(n: number): boolean {
  return ALLOWED_REFILL_AMOUNTS.some((a) => Math.abs(a - n) < 1e-6);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const { user, error: authError } = await authenticateRequest(request);
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from('agent_accounts')
    .select(
      'auto_top_up, auto_top_up_amount, auto_top_up_threshold, stripe_payment_method_id',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[billing-config] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load billing settings' },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  if (!account) {
    return NextResponse.json(
      { error: 'Account not found' },
      { status: 404, headers: getCorsHeaders(origin) },
    );
  }

  return NextResponse.json(
    {
      auto_top_up: Boolean(account.auto_top_up),
      auto_top_up_amount: parseFloat(String(account.auto_top_up_amount ?? 50)),
      auto_top_up_threshold: parseFloat(String(account.auto_top_up_threshold ?? 5)),
      has_payment_method: Boolean(account.stripe_payment_method_id),
      allowed_refill_amounts: [...ALLOWED_REFILL_AMOUNTS],
      threshold_bounds: { min: MIN_THRESHOLD, max: MAX_THRESHOLD },
    },
    { headers: getCorsHeaders(origin) },
  );
}

type PatchBody = {
  auto_top_up?: boolean;
  auto_top_up_amount?: number;
  auto_top_up_threshold?: number;
};

export async function PATCH(request: NextRequest) {
  const origin = request.headers.get('origin');
  const { user, error: authError } = await authenticateRequest(request);
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: getCorsHeaders(origin) },
    );
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const { auto_top_up, auto_top_up_amount, auto_top_up_threshold } = body;

  if (
    auto_top_up === undefined &&
    auto_top_up_amount === undefined &&
    auto_top_up_threshold === undefined
  ) {
    return NextResponse.json(
      {
        error: 'No updates',
        message:
          'Provide at least one of: auto_top_up, auto_top_up_amount, auto_top_up_threshold',
      },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  if (auto_top_up !== undefined && typeof auto_top_up !== 'boolean') {
    return NextResponse.json(
      { error: 'auto_top_up must be a boolean' },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  if (auto_top_up_amount !== undefined) {
    if (typeof auto_top_up_amount !== 'number' || Number.isNaN(auto_top_up_amount)) {
      return NextResponse.json(
        { error: 'auto_top_up_amount must be a number' },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
    if (!isAllowedRefillAmount(auto_top_up_amount)) {
      return NextResponse.json(
        {
          error: 'Invalid auto_top_up_amount',
          message: `Must be one of: ${ALLOWED_REFILL_AMOUNTS.join(', ')}`,
          allowed: [...ALLOWED_REFILL_AMOUNTS],
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
  }

  if (auto_top_up_threshold !== undefined) {
    if (
      typeof auto_top_up_threshold !== 'number' ||
      Number.isNaN(auto_top_up_threshold) ||
      auto_top_up_threshold < MIN_THRESHOLD ||
      auto_top_up_threshold > MAX_THRESHOLD
    ) {
      return NextResponse.json(
        {
          error: 'Invalid auto_top_up_threshold',
          message: `Must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD} (USD)`,
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
  }

  const admin = createAdminClient();

  if (auto_top_up === true) {
    const { data: acct } = await admin
      .from('agent_accounts')
      .select('stripe_payment_method_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!acct?.stripe_payment_method_id) {
      return NextResponse.json(
        {
          error: 'No payment method',
          message: 'Add a card before enabling auto-refill',
        },
        { status: 400, headers: getCorsHeaders(origin) },
      );
    }
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (auto_top_up !== undefined) updateData.auto_top_up = auto_top_up;
  if (auto_top_up_amount !== undefined) {
    updateData.auto_top_up_amount = auto_top_up_amount;
  }
  if (auto_top_up_threshold !== undefined) {
    updateData.auto_top_up_threshold = auto_top_up_threshold;
  }

  const { error: updateError } = await admin
    .from('agent_accounts')
    .update(updateData)
    .eq('user_id', user.id);

  if (updateError) {
    console.error('[billing-config] PATCH error:', updateError);
    return NextResponse.json(
      { error: 'Failed to update billing settings' },
      { status: 500, headers: getCorsHeaders(origin) },
    );
  }

  const { data: updated } = await admin
    .from('agent_accounts')
    .select('auto_top_up, auto_top_up_amount, auto_top_up_threshold')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json(
    {
      success: true,
      auto_top_up: Boolean(updated?.auto_top_up),
      auto_top_up_amount: parseFloat(String(updated?.auto_top_up_amount ?? 50)),
      auto_top_up_threshold: parseFloat(String(updated?.auto_top_up_threshold ?? 5)),
    },
    { headers: getCorsHeaders(origin) },
  );
}
