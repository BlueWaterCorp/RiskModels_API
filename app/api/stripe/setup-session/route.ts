/**
 * POST /api/stripe/setup-session
 * Creates a Stripe Checkout session to activate API access.
 *
 * Two shapes, chosen by the optional `prepayUsd` in the body:
 *  - prepayUsd === 0 (or omitted) → Setup Mode: saves a card for identity
 *    verification, $0 charged now. The $20 free credit is applied after.
 *  - prepayUsd ∈ {25, 50, 100} → Payment Mode: charges the prepay amount AND
 *    saves the card (setup_future_usage), in one step. setup-success then
 *    credits the prepaid amount on top of the $20 free.
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl } from '@/lib/app-url';

/** Keep in sync with the tier selector on /get-key and setup-success crediting. */
const ALLOWED_PREPAY_USD = new Set([0, 25, 50, 100]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    let prepayUsd = Number((body as { prepayUsd?: unknown }).prepayUsd ?? 0);
    if (!Number.isFinite(prepayUsd) || !ALLOWED_PREPAY_USD.has(prepayUsd)) {
      prepayUsd = 0; // unknown / tampered amount → fall back to the free $0 path
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const admin = createAdminClient();

    // Find or create Stripe customer
    const { data: account } = await admin
      .from('agent_accounts')
      .select('stripe_customer_id, balance_usd')
      .eq('user_id', user.id)
      .maybeSingle();

    // Will the once-per-account $20 free credit apply? Mirrors setup-success's
    // guard so the checkout message promises exactly what will be credited.
    const { data: priorFree } = await admin
      .from('billing_events')
      .select('id')
      .eq('user_id', user.id)
      .in('capability_id', ['free_credit', 'starter_credit'])
      .limit(1)
      .maybeSingle();
    const currentBalance = parseFloat(String(account?.balance_usd ?? 0));
    const freeUsd = !priorFree && currentBalance < 20 ? 20 : 0;

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

    const common = {
      customer: customerId,
      // Link + card — phone / in-app verification flows need Link; metadata alone can be dropped in edge cases,
      // so client_reference_id duplicates user id for setup-success.
      payment_method_types: ['card', 'link'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      client_reference_id: user.id,
      success_url: `${getAppUrl()}/api/stripe/setup-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getAppUrl()}/get-key?stripe=cancelled`,
      metadata: { user_id: user.id, purpose: 'api_key_setup', prepay_usd: String(prepayUsd) },
    };

    const session = await stripe.checkout.sessions.create(
      prepayUsd > 0
        ? {
            ...common,
            mode: 'payment',
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  product_data: { name: `RiskModels API credits — $${prepayUsd}` },
                  unit_amount: prepayUsd * 100,
                },
                quantity: 1,
              },
            ],
            // Save the card for later auto-refill while charging the prepay now.
            payment_intent_data: {
              setup_future_usage: 'off_session',
              metadata: { user_id: user.id, prepay_usd: String(prepayUsd) },
            },
            custom_text: {
              submit: {
                message:
                  freeUsd > 0
                    ? `You'll be charged $${prepayUsd} now and receive $${prepayUsd + freeUsd} in credits ($${freeUsd} free included). Your card is saved for future billing.`
                    : `You'll be charged $${prepayUsd} now and $${prepayUsd} in API credits will be added to your balance. Your card is saved for future billing.`,
              },
            },
          }
        : {
            ...common,
            mode: 'setup',
            custom_text: {
              submit: { message: 'Your card is saved for billing. You will not be charged now.' },
            },
          },
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[setup-session]', err);
    return NextResponse.json({ error: 'Failed to create setup session' }, { status: 500 });
  }
}
