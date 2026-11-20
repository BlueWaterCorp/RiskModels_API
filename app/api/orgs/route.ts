import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listOrgsForUser } from '@/lib/agent/orgs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orgs — the signed-in user's orgs (relation "member") and orgs their
 * verified email domain may join (relation "joinable"). Balance and daily cap
 * are included for org admins only.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const orgs = await listOrgsForUser(user);
    return NextResponse.json({ orgs });
  } catch (e) {
    console.error('[orgs] list failed:', e);
    return NextResponse.json({ error: 'Could not load organizations' }, { status: 500 });
  }
}
