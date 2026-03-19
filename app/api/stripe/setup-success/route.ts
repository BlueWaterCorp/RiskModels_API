/**
 * GET /api/stripe/setup-success?session_id=...
 * Called by Stripe after Setup Mode checkout completes.
 * Provisions agent_accounts with $20 free credits and generates an API key.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateUserApiKey } from '@/lib/user-api-keys';
import { getAppUrl } from '@/lib/app-url';
const FREE_CREDIT_USD = 20;
const DEFAULT_REFILL_THRESHOLD = 5.0;
const DEFAULT_REFILL_AMOUNT = 50.0;

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  const appUrl = getAppUrl();
  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const admin = createAdminClient();

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== 'complete') {
      return NextResponse.redirect(`${appUrl}/get-key?stripe=incomplete`);
    }

    const userId = session.metadata?.user_id;
    if (!userId) {
      return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
    }

    // Get the saved payment method from the SetupIntent
    const setupIntent = session.setup_intent
      ? await stripe.setupIntents.retrieve(session.setup_intent as string)
      : null;
    const paymentMethodId = setupIntent?.payment_method as string | undefined;

    // Get user email
    const { data: { user } } = await admin.auth.admin.getUserById(userId);
    const email = user?.email || '';

    // Upsert agent_accounts record with Stripe info and $20 credit
    const { data: existingAccount } = await admin
      .from('agent_accounts')
      .select('id, balance_usd')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingAccount) {
      const current = parseFloat(String(existingAccount.balance_usd ?? 0));
      const updates: Record<string, unknown> = {
        stripe_customer_id: session.customer as string,
        auto_top_up: true,
        auto_top_up_threshold: DEFAULT_REFILL_THRESHOLD,
        auto_top_up_amount: DEFAULT_REFILL_AMOUNT,
        updated_at: new Date().toISOString(),
      };
      if (current < FREE_CREDIT_USD) {
        updates.balance_usd = FREE_CREDIT_USD;
      }
      const { error: updateErr } = await admin
        .from('agent_accounts').update(updates).eq('id', existingAccount.id);
      if (updateErr) console.error('[setup-success] update error:', updateErr);
    } else {
      const { error: insertErr } = await admin.from('agent_accounts').insert({
        user_id: userId,
        agent_id: `api_${Date.now()}`,
        agent_name: email || 'API User',
        contact_email: email,
        balance_usd: FREE_CREDIT_USD,
        stripe_customer_id: session.customer as string,
        auto_top_up: true,
        auto_top_up_threshold: DEFAULT_REFILL_THRESHOLD,
        auto_top_up_amount: DEFAULT_REFILL_AMOUNT,
        status: 'active',
      });
      if (insertErr) console.error('[setup-success] insert error:', insertErr);
    }

    // Check if user already has an active API key
    const { data: existingKey } = await admin
      .from('agent_api_keys')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!existingKey) {
      const { plainKey, hashedKey, prefix } = generateUserApiKey('live');
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      await admin.from('agent_api_keys').insert({
        user_id: userId,
        key_hash: hashedKey,
        key_prefix: prefix,
        name: 'API Key (Card Verified)',
        scopes: ['*'],
        rate_limit_per_minute: 60,
        expires_at: expiresAt,
      });

      // Pass key prefix as a hint so the dashboard can show a reveal prompt
      return NextResponse.redirect(`${appUrl}/get-key?stripe=success&kp=${encodeURIComponent(prefix)}`);
    }

    return NextResponse.redirect(`${appUrl}/get-key?stripe=success`);
  } catch (err) {
    console.error('[setup-success]', err);
    return NextResponse.redirect(`${appUrl}/get-key?stripe=error`);
  }
}
