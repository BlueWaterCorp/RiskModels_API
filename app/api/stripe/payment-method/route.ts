/**
 * DELETE /api/stripe/payment-method
 * Removes ONE saved card: body `{ paymentMethodId }`. The id is validated
 * against the caller's Stripe customer before detaching. If the removed card
 * was the default (agent_accounts.stripe_payment_method_id — the one top-ups /
 * auto-refill charge), the default moves to the next remaining card; when no
 * cards remain, the column is cleared and auto_top_up is disabled
 * (billing-config refuses auto-refill without a card on file).
 *
 * Idempotent: a card already gone on Stripe's side still resyncs the default.
 * Adding a card is the normal /get-key Checkout setup flow.
 *
 * Auth: browser session only (same as setup-session).
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const paymentMethodId = (body as { paymentMethodId?: unknown }).paymentMethodId;
    if (typeof paymentMethodId !== 'string' || !paymentMethodId.startsWith('pm_')) {
      return NextResponse.json({ error: 'paymentMethodId required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: account } = await admin
      .from('agent_accounts')
      .select('stripe_customer_id, stripe_payment_method_id, auto_top_up')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!account?.stripe_customer_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const customerId = account.stripe_customer_id as string;
    const recordedDefault = (account.stripe_payment_method_id as string | null) ?? null;

    // Ownership check — only detach cards actually attached to this customer.
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer !== customerId) {
        return NextResponse.json({ error: 'Payment method not found' }, { status: 404 });
      }
    } catch (err) {
      // Already gone on Stripe's side — fall through so the default resyncs.
      if ((err as Stripe.errors.StripeError)?.code !== 'resource_missing') throw err;
    }

    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
      if ((err as Stripe.errors.StripeError)?.code !== 'resource_missing') {
        console.error('[payment-method] detach failed:', err);
        return NextResponse.json({ error: 'Failed to remove card with Stripe' }, { status: 502 });
      }
    }

    // Resync the default if the removed card was it.
    let newDefault = recordedDefault;
    let autoTopUp = Boolean(account.auto_top_up);
    if (recordedDefault === paymentMethodId) {
      const remaining = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 100 });
      newDefault = remaining.data[0]?.id ?? null;
      if (!newDefault) autoTopUp = false;

      const { error: updateError } = await admin
        .from('agent_accounts')
        .update({
          stripe_payment_method_id: newDefault,
          auto_top_up: autoTopUp,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('[payment-method] account update failed:', updateError);
        return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, default_payment_method_id: newDefault });
  } catch (err) {
    console.error('[payment-method]', err);
    return NextResponse.json({ error: 'Failed to remove payment method' }, { status: 500 });
  }
}
