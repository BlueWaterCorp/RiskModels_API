/**
 * GET /api/stripe/payment-methods
 * Lists the caller's saved cards. Stripe is the source of truth (legacy
 * activations predate the stripe_payment_method_id column, so the DB alone
 * would hide cards). is_default marks the card top-ups / auto-refill charge.
 *
 * Auth: browser session only (same as setup-session).
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: account } = await admin
      .from('agent_accounts')
      .select('stripe_customer_id, stripe_payment_method_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!account?.stripe_customer_id) {
      return NextResponse.json({ cards: [], default_payment_method_id: null });
    }

    let defaultId = (account.stripe_payment_method_id as string | null) ?? null;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const pms = await stripe.paymentMethods.list({
      customer: account.stripe_customer_id as string,
      type: 'card',
      limit: 100,
    });

    // Legacy activations never recorded a default — adopt the first attached
    // card so the badge is right on first render (same heal /api/account does).
    if (!defaultId && pms.data.length > 0) {
      defaultId = pms.data[0].id;
      await admin
        .from('agent_accounts')
        .update({ stripe_payment_method_id: defaultId, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    const cards = pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '????',
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      is_default: pm.id === defaultId,
    }));

    // Sort default first so the card we charge is always on top.
    cards.sort((a, b) => Number(b.is_default) - Number(a.is_default));

    return NextResponse.json({ cards, default_payment_method_id: defaultId });
  } catch (err) {
    console.error('[payment-methods]', err);
    return NextResponse.json({ error: 'Failed to list payment methods' }, { status: 500 });
  }
}
