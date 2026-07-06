/**
 * POST /api/stripe/webhook
 * Crediting backstop for prepay checkouts (backlog T.15).
 *
 * Crediting is normally driven by Stripe's success redirect to
 * /api/stripe/setup-success — but a user who closes the tab before the
 * redirect lands is charged without ever being credited (exactly what the
 * T.1 live test exercised). This endpoint listens for
 * `checkout.session.completed` and runs the same handler, whose crediting is
 * idempotent per PaymentIntent / per-account free credit, so redirect +
 * webhook double-delivery is safe.
 *
 * Env: STRIPE_WEBHOOK_SECRET — signing secret of the riskmodels.app endpoint
 * (Doppler erm3/prd → Vercel riskmodels-api via the daily sync).
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { GET as runSetupSuccess } from '../setup-success/route';
import { getAppUrl } from '@/lib/app-url';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const payload = await req.text();
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  // Only sessions created by /api/stripe/setup-session; ignore anything else
  // (e.g. future products) rather than crediting on unknown flows.
  if (session.metadata?.purpose !== 'api_key_setup') {
    return NextResponse.json({ received: true, ignored: 'purpose' });
  }

  // Re-run the idempotent success handler; its redirect target encodes the outcome.
  const result = await runSetupSuccess(
    new NextRequest(`${getAppUrl()}/api/stripe/setup-success?session_id=${encodeURIComponent(session.id)}`),
  );
  const outcome = result.headers.get('location') ?? '';
  const failed = /stripe=(error|account_error|key_error)/.test(outcome);
  if (failed) {
    console.error('[stripe-webhook] crediting failed for session', session.id, '→', outcome);
    // Non-2xx so Stripe retries — the failure may be transient (e.g. DB blip).
    return NextResponse.json({ error: 'crediting failed' }, { status: 500 });
  }

  console.log('[stripe-webhook] processed', session.id, '→', outcome);
  return NextResponse.json({ received: true });
}
