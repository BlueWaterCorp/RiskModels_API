import { NextResponse } from 'next/server';
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
    .select('balance_usd, stripe_customer_id, auto_top_up, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) return NextResponse.json(null);
  return NextResponse.json(data);
}
