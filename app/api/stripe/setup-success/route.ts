/**
 * GET /api/stripe/setup-success?session_id=...
 * Called by Stripe after Setup Mode checkout completes.
 * Provisions agent_accounts with $20 free credits and generates a user API key (rm_user_*).
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

/** After Link / phone verification, Checkout can still be `open` briefly while SetupIntent is already `succeeded`. */
function isCheckoutSetupFinished(session: Stripe.Checkout.Session, setupIntent: Stripe.SetupIntent | null): boolean {
  if (session.status === 'complete') return true;
  if (setupIntent?.status === 'succeeded') return true;
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
      expand: ['setup_intent'],
    });

    let setupIntent = setupIntentFromSession(session);
    if (!setupIntent && session.setup_intent && typeof session.setup_intent === 'string') {
      setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
    }

    if (
      setupIntent?.status === 'processing' ||
      setupIntent?.status === 'requires_action' ||
      setupIntent?.status === 'requires_confirmation'
    ) {
      console.warn('[setup-success] setup_intent still pending', {
        sessionId,
        sessionStatus: session.status,
        setupIntentStatus: setupIntent.status,
      });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=processing`);
    }

    if (!isCheckoutSetupFinished(session, setupIntent)) {
      console.warn('[setup-success] session not ready', {
        sessionId,
        sessionStatus: session.status,
        setupIntentStatus: setupIntent?.status ?? null,
      });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=incomplete`);
    }

    const userId = session.metadata?.user_id || session.client_reference_id || undefined;
    if (!userId) {
      console.error('[setup-success] missing user id on session', { sessionId, hasMetadata: !!session.metadata });
      return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
    }

    const paymentMethodId =
      (setupIntent?.payment_method as string | undefined) ?? undefined;

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

    if (existingAccount) {
      const current = parseFloat(String(existingAccount.balance_usd ?? 0));
      const updates: Record<string, unknown> = {
        stripe_customer_id: session.customer as string,
        stripe_payment_method_id: paymentMethodId ?? null,
        contact_email: email,
        auto_top_up: false,
        auto_top_up_threshold: DEFAULT_REFILL_THRESHOLD,
        auto_top_up_amount: DEFAULT_REFILL_AMOUNT,
        updated_at: new Date().toISOString(),
      };
      if (current < FREE_CREDIT_USD) {
        updates.balance_usd = FREE_CREDIT_USD;
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
        balance_usd: FREE_CREDIT_USD,
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
        `${appUrl}/get-key?stripe=success&kp=${encodeURIComponent(keyMaterial.prefix)}`,
      );
    }

    return NextResponse.redirect(`${appUrl}/get-key?stripe=success`);
  } catch (err) {
    console.error('[setup-success]', err);
    return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
  }
}
