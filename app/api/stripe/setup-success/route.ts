/**
 * GET /api/stripe/setup-success?session_id=...
 * Called by Stripe after Checkout completes (Setup or Payment mode).
 *
 * Provisions agent_accounts and credits the balance:
 *  - $20 free, granted at most once per account.
 *  - For Payment-mode sessions, the prepaid amount on top, credited at most
 *    once per PaymentIntent (idempotent on page refresh / handler re-run).
 * Also generates a user API key (rm_user_*) on first activation.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateUserApiKey } from '@/lib/user-api-keys';
import { getAppUrl } from '@/lib/app-url';

const FREE_CREDIT_USD = 20;
/** When the user enables auto-refill later, charges run when balance is below this (USD). */
const DEFAULT_REFILL_THRESHOLD = 5.0;
/** Preferred refill size (USD) — stored for when they opt in; auto-refill is off at signup. */
const DEFAULT_REFILL_AMOUNT = 50.0;

function setupIntentFromSession(session: Stripe.Checkout.Session): Stripe.SetupIntent | null {
  const si = session.setup_intent;
  if (!si || typeof si === 'string') return null;
  return si as Stripe.SetupIntent;
}

function paymentIntentFromSession(session: Stripe.Checkout.Session): Stripe.PaymentIntent | null {
  const pi = session.payment_intent;
  if (!pi || typeof pi === 'string') return null;
  return pi as Stripe.PaymentIntent;
}

/** After Link / phone verification, Checkout can still be `open` briefly while the intent is already done. */
function isCheckoutFinished(
  session: Stripe.Checkout.Session,
  setupIntent: Stripe.SetupIntent | null,
  paymentIntent: Stripe.PaymentIntent | null,
): boolean {
  if (session.status === 'complete') return true;
  if (setupIntent?.status === 'succeeded') return true;
  if (paymentIntent?.status === 'succeeded') return true;
  return false;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  const appUrl = getAppUrl();
  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const admin = createAdminClient();

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['setup_intent', 'payment_intent'],
    });

    const isPaymentMode = session.mode === 'payment';

    let setupIntent = setupIntentFromSession(session);
    if (!setupIntent && session.setup_intent && typeof session.setup_intent === 'string') {
      setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
    }

    let paymentIntent = paymentIntentFromSession(session);
    if (!paymentIntent && session.payment_intent && typeof session.payment_intent === 'string') {
      paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
    }

    // Pending states — let the page poll/refresh rather than crediting early.
    const pendingStatuses = new Set(['processing', 'requires_action', 'requires_confirmation']);
    if (
      (setupIntent && pendingStatuses.has(setupIntent.status)) ||
      (paymentIntent && pendingStatuses.has(paymentIntent.status))
    ) {
      console.warn('[setup-success] intent still pending', {
        sessionId,
        sessionStatus: session.status,
        setupIntentStatus: setupIntent?.status ?? null,
        paymentIntentStatus: paymentIntent?.status ?? null,
      });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=processing`);
    }

    if (!isCheckoutFinished(session, setupIntent, paymentIntent)) {
      console.warn('[setup-success] session not ready', {
        sessionId,
        sessionStatus: session.status,
        setupIntentStatus: setupIntent?.status ?? null,
        paymentIntentStatus: paymentIntent?.status ?? null,
      });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=incomplete`);
    }

    const userId = session.metadata?.user_id || session.client_reference_id || undefined;
    if (!userId) {
      console.error('[setup-success] missing user id on session', { sessionId, hasMetadata: !!session.metadata });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
    }

    // Card was saved by either a SetupIntent ($0 path) or the PaymentIntent (setup_future_usage).
    const paymentMethodId =
      (setupIntent?.payment_method as string | undefined) ??
      (paymentIntent?.payment_method as string | undefined) ??
      undefined;

    // Amount actually paid (cents → USD). Source of truth is the PaymentIntent; fall back to metadata.
    const prepaidUsd = isPaymentMode
      ? (paymentIntent?.amount_received ?? session.amount_total ?? 0) / 100
      : 0;
    const paymentIntentId = paymentIntent?.id ?? null;

    const { data: { user } } = await admin.auth.admin.getUserById(userId);
    const email = user?.email || '';

    const { data: existingAccount, error: accountSelectErr } = await admin
      .from('agent_accounts')
      .select('id, balance_usd')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (accountSelectErr) {
      console.error('[setup-success] agent_accounts select error:', accountSelectErr);
    }

    const currentBalance = existingAccount
      ? parseFloat(String(existingAccount.balance_usd ?? 0))
      : 0;

    // ── Decide what to credit (each guard is independent and idempotent) ──────────

    // $20 free: at most once per account. Skip if a prior free/starter credit was
    // recorded, or if the account already carries at least the free amount (covers
    // legacy accounts provisioned before we logged a free_credit event).
    const { data: priorFree } = await admin
      .from('billing_events')
      .select('id')
      .eq('user_id', userId)
      .in('capability_id', ['free_credit', 'starter_credit'])
      .limit(1)
      .maybeSingle();
    const grantFree = !priorFree && currentBalance < FREE_CREDIT_USD;

    // Prepaid amount: at most once per PaymentIntent.
    let grantPrepaid = 0;
    if (isPaymentMode && paymentIntentId && prepaidUsd > 0) {
      const { data: priorTopUp } = await admin
        .from('balance_top_ups')
        .select('id, status')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle();
      if (!priorTopUp || priorTopUp.status !== 'completed') {
        grantPrepaid = prepaidUsd;
      }
    }

    const creditTotal = (grantFree ? FREE_CREDIT_USD : 0) + grantPrepaid;
    const newBalance = currentBalance + creditTotal;

    // ── Upsert the account ────────────────────────────────────────────────────────
    if (existingAccount) {
      // Newest saved card becomes the default. Auto-refill prefs are NOT reset
      // here — re-running setup (e.g. "Add card" from /get-key) must not wipe
      // them; the defaults below apply to first-time inserts only.
      const updates: Record<string, unknown> = {
        stripe_customer_id: session.customer as string,
        stripe_payment_method_id: paymentMethodId ?? null,
        contact_email: email,
        updated_at: new Date().toISOString(),
      };
      if (creditTotal > 0) {
        updates.balance_usd = newBalance;
      }
      const { error: updateErr } = await admin
        .from('agent_accounts')
        .update(updates)
        .eq('id', existingAccount.id);
      if (updateErr) {
        console.error('[setup-success] agent_accounts update error:', updateErr);
        return NextResponse.redirect(`${appUrl}/get-key?stripe=account_error`);
      }
    } else {
      const { error: insertErr } = await admin.from('agent_accounts').insert({
        user_id: userId,
        agent_id: `api_${Date.now()}`,
        agent_name: email || 'API User',
        contact_email: email || session.customer_details?.email || 'pending@riskmodels.app',
        balance_usd: creditTotal,
        stripe_customer_id: session.customer as string,
        stripe_payment_method_id: paymentMethodId ?? null,
        auto_top_up: false,
        auto_top_up_threshold: DEFAULT_REFILL_THRESHOLD,
        auto_top_up_amount: DEFAULT_REFILL_AMOUNT,
        status: 'active',
      });
      if (insertErr) {
        console.error('[setup-success] agent_accounts insert error:', insertErr);
        return NextResponse.redirect(`${appUrl}/get-key?stripe=account_error`);
      }
    }

    // ── Record ledger entries (best-effort; never block activation) ────────────────
    if (grantFree) {
      const { error: freeEvtErr } = await admin.from('billing_events').insert({
        user_id: userId,
        request_id: `free_${session.id}`,
        capability_id: 'free_credit',
        cost_usd: -FREE_CREDIT_USD,
        balance_after_usd: newBalance,
        type: 'credit',
        description: 'One-time $20 free API credit',
        metadata: { source: 'setup_success', session_id: session.id },
        created_at: new Date().toISOString(),
      });
      if (freeEvtErr) console.error('[setup-success] free_credit event error:', freeEvtErr);
    }

    if (grantPrepaid > 0 && paymentIntentId) {
      // Idempotency anchor for the prepaid charge.
      const { error: topUpErr } = await admin.from('balance_top_ups').insert({
        user_id: userId,
        stripe_payment_intent_id: paymentIntentId,
        amount_usd: grantPrepaid,
        status: 'completed',
        metadata: { source: 'setup_success', session_id: session.id },
        created_at: new Date().toISOString(),
      });
      if (topUpErr) console.error('[setup-success] balance_top_ups insert error:', topUpErr);

      const { error: paidEvtErr } = await admin.from('billing_events').insert({
        user_id: userId,
        request_id: `prepay_${paymentIntentId}`,
        capability_id: 'prepaid_topup',
        cost_usd: -grantPrepaid,
        balance_after_usd: newBalance,
        type: 'credit',
        description: `Prepaid API credits ($${grantPrepaid})`,
        metadata: { source: 'setup_success', session_id: session.id, payment_intent_id: paymentIntentId },
        created_at: new Date().toISOString(),
      });
      if (paidEvtErr) console.error('[setup-success] prepaid_topup event error:', paidEvtErr);
    }

    // ── Ensure the user has a key ──────────────────────────────────────────────────
    const { data: existingUserKey, error: keySelectErr } = await admin
      .from('user_generated_api_keys')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (keySelectErr) {
      console.error('[setup-success] user_generated_api_keys select error:', keySelectErr);
    }

    if (!existingUserKey) {
      const keyMaterial = generateUserApiKey('live');
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      const { error: keyErr } = await admin.from('user_generated_api_keys').insert({
        user_id: userId,
        key_hash: keyMaterial.hashedKey,
        key_prefix: keyMaterial.prefix,
        name: 'API Key (Card Verified)',
        scopes: ['read'],
        rate_limit_per_minute: 60,
        expires_at: expiresAt,
      });

      if (keyErr) {
        console.error('[setup-success] user_generated_api_keys insert error:', keyErr);
        return NextResponse.redirect(`${appUrl}/get-key?stripe=key_error`);
      }

      return NextResponse.redirect(
        `${appUrl}/get-key?stripe=success&free=${grantFree ? '1' : '0'}&kp=${encodeURIComponent(keyMaterial.prefix)}`,
      );
    }

    return NextResponse.redirect(`${appUrl}/get-key?stripe=success&free=${grantFree ? '1' : '0'}`);
  } catch (err) {
    console.error('[setup-success]', err);
    return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
  }
}
