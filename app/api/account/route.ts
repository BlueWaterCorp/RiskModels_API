import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  // Verify session with the user-scoped client
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Use admin client to bypass RLS on agent_accounts
  const admin = createAdminClient();
  const { data } = await admin
    .from('agent_accounts')
    .select('balance_usd, stripe_customer_id, stripe_payment_method_id, auto_top_up, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) return NextResponse.json(null);

  // Self-heal legacy activations: card attached at Stripe but never recorded in
  // stripe_payment_method_id. Without this those users see no card state and
  // have no way to remove it. One Stripe call, only for affected rows.
  if (!data.stripe_payment_method_id && data.stripe_customer_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const pms = await stripe.paymentMethods.list({
        customer: data.stripe_customer_id,
        type: 'card',
        limit: 1,
      });
      const pm = pms.data[0];
      if (pm) {
        data.stripe_payment_method_id = pm.id;
        await admin
          .from('agent_accounts')
          .update({ stripe_payment_method_id: pm.id, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
    } catch (err) {
      // Stripe hiccup must not break the account endpoint — return the row as-is.
      console.error('[account] payment-method backfill failed:', err);
    }
  }

  return NextResponse.json(data);
}
