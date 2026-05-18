import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStatsForUser } from '@/lib/agent/affiliate';

export const dynamic = 'force-dynamic';

/**
 * Self-serve affiliate stats. Scoped to the requester's own affiliate row only.
 *
 * - 401 if not signed in
 * - 404 if the signed-in user has no affiliate row (we don't leak existence info)
 * - 200 with { affiliate, stats } otherwise
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await getStatsForUser(admin, user.id);
  if (!result) {
    return NextResponse.json({ error: 'Not an affiliate' }, { status: 404 });
  }
  return NextResponse.json(result);
}
