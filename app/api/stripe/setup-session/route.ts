/**
 * POST /api/stripe/setup-session
 * Creates a Stripe Checkout session in Setup Mode.
 * Collects a card for identity verification — $0 charged now.
 * The $20 free credit is applied after the card is saved.
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl } from '@/lib/app-url';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const admin = createAdminClient();

    // Find or create Stripe customer
    const { data: account } = await admin
      .from('agent_accounts')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId: string;
    if (account?.stripe_customer_id) {
      customerId = account.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: `${getAppUrl()}/api/stripe/setup-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getAppUrl()}/get-key?stripe=cancelled`,
      custom_text: {
        submit: { message: 'Your card is saved for billing. You will not be charged now.' },
      },
      metadata: { user_id: user.id, purpose: 'api_key_setup' },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[setup-session]', err);
    return NextResponse.json({ error: 'Failed to create setup session' }, { status: 500 });
  }
}
