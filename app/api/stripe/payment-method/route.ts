/**
 * DELETE /api/stripe/payment-method
 * Removes the caller's saved card: detaches the payment method in Stripe and
 * clears stripe_payment_method_id on agent_accounts. Auto-refill is disabled
 * as a side effect (billing-config blocks auto_top_up without a card on file).
 *
 * Idempotent: a payment method already gone on Stripe's side still clears the
 * local record. Adding a new card afterwards is the normal /get-key flow.
 *
 * Auth: browser session only (same as setup-session).
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: account } = await admin
      .from('agent_accounts')
      .select('stripe_payment_method_id, auto_top_up')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const paymentMethodId = account.stripe_payment_method_id as string | null;
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No payment method on file' }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
      // Already detached/expired on Stripe's side — fall through and clear our record.
      if ((err as Stripe.errors.StripeError)?.code !== 'resource_missing') {
        console.error('[payment-method] detach failed:', err);
        return NextResponse.json({ error: 'Failed to remove card with Stripe' }, { status: 502 });
      }
    }

    const hadAutoTopUp = Boolean(account.auto_top_up);
    const { error: updateError } = await admin
      .from('agent_accounts')
      .update({
        stripe_payment_method_id: null,
        auto_top_up: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('[payment-method] account update failed:', updateError);
      return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
    }

    return NextResponse.json({ success: true, auto_top_up_disabled: hadAutoTopUp });
  } catch (err) {
    console.error('[payment-method]', err);
    return NextResponse.json({ error: 'Failed to remove payment method' }, { status: 500 });
  }
}
