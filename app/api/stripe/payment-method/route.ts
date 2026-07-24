/**
 * DELETE /api/stripe/payment-method
 * Removes the caller's saved card(s): detaches the recorded payment method AND
 * any other card attached to the Stripe customer (legacy activations predate
 * the stripe_payment_method_id column, so some cards were never recorded
 * locally). Clears stripe_payment_method_id on agent_accounts and disables
 * auto_top_up (billing-config refuses auto-refill without a card on file).
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
      .select('stripe_customer_id, stripe_payment_method_id, auto_top_up')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Every card we know about: the recorded one plus any still attached to the
    // customer at Stripe. If the Stripe list call fails we can still act on the
    // recorded id; the user can retry to catch the rest.
    const paymentMethodIds = new Set<string>();
    if (account.stripe_payment_method_id) {
      paymentMethodIds.add(account.stripe_payment_method_id as string);
    }
    if (account.stripe_customer_id) {
      try {
        const attached = await stripe.paymentMethods.list({
          customer: account.stripe_customer_id as string,
          type: 'card',
          limit: 100,
        });
        for (const pm of attached.data) paymentMethodIds.add(pm.id);
      } catch (err) {
        console.error('[payment-method] list attached cards failed:', err);
      }
    }

    if (paymentMethodIds.size === 0) {
      return NextResponse.json({ error: 'No payment method on file' }, { status: 400 });
    }

    for (const id of paymentMethodIds) {
      try {
        await stripe.paymentMethods.detach(id);
      } catch (err) {
        // Already detached/expired on Stripe's side — keep going.
        if ((err as Stripe.errors.StripeError)?.code !== 'resource_missing') {
          console.error('[payment-method] detach failed:', err);
          return NextResponse.json({ error: 'Failed to remove card with Stripe' }, { status: 502 });
        }
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

    return NextResponse.json({
      success: true,
      removed: paymentMethodIds.size,
      auto_top_up_disabled: hadAutoTopUp,
    });
  } catch (err) {
    console.error('[payment-method]', err);
    return NextResponse.json({ error: 'Failed to remove payment method' }, { status: 500 });
  }
}
