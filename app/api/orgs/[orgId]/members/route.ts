import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  JOIN_ERROR_MESSAGES,
  getActiveMembership,
  joinErrorStatus,
  joinOrg,
  removeOrgMember,
} from '@/lib/agent/orgs';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ orgId: string }> };

/** Signed-in org admin, or a ready-to-send error response. */
async function requireOrgAdmin(
  orgId: string,
): Promise<{ userId: string } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const membership = await getActiveMembership(orgId, user.id).catch(() => null);
  if (membership?.role !== 'admin') {
    return {
      response: NextResponse.json({ error: 'Organization admin access required' }, { status: 403 }),
    };
  }
  return { userId: user.id };
}

/** GET — members of the org with their count of active org keys. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgAdmin(orgId);
  if ('response' in auth) return auth.response;

  const admin = createAdminClient();
  const { data: members, error } = await admin
    .from('api_org_members')
    .select('user_id, email, role, joined_via, joined_at, removed_at')
    .eq('org_id', orgId)
    .order('joined_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Could not load members' }, { status: 500 });

  const { data: keys } = await admin
    .from('agent_api_keys')
    .select('user_id, revoked_at, expires_at')
    .eq('org_id', orgId)
    .is('revoked_at', null);
  const now = Date.now();
  const activeKeys: Record<string, number> = {};
  for (const k of keys ?? []) {
    if (k.expires_at && new Date(k.expires_at as string).getTime() < now) continue;
    activeKeys[k.user_id as string] = (activeKeys[k.user_id as string] ?? 0) + 1; // allow-default: counter - first key for this member
  }

  return NextResponse.json({
    members: (members ?? []).map((m) => ({
      ...m,
      status: m.removed_at ? 'removed' : 'active',
      active_keys: activeKeys[m.user_id as string] ?? 0, // allow-default: counter - member with no active org key
    })),
  });
}

/**
 * POST { email, role? } — add a member. The person must already have a
 * riskmodels.app account; otherwise share the domain join or a seat code.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgAdmin(orgId);
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email.includes('@')) {
    return NextResponse.json({ error: JOIN_ERROR_MESSAGES.invalid_email }, { status: 400 });
  }
  const role = body.role === 'admin' ? 'admin' : 'member';

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (!profile?.id) {
    return NextResponse.json(
      {
        error: 'No account for that email yet',
        message:
          'Ask them to sign in at riskmodels.app/get-key first (a company email on the allowlist joins automatically), then add them here.',
      },
      { status: 404 },
    );
  }

  const joined = await joinOrg({
    orgId,
    userId: profile.id as string,
    email,
    via: 'org_admin',
    role,
    invitedBy: auth.userId,
  });
  if (!joined.ok) {
    return NextResponse.json(
      { error: JOIN_ERROR_MESSAGES[joined.error_code], error_code: joined.error_code },
      { status: joinErrorStatus(joined.error_code) },
    );
  }
  return NextResponse.json({ success: true, member_id: joined.memberId, already_member: joined.alreadyMember });
}

/** DELETE { user_id } — end a membership; that member's org keys are revoked. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgAdmin(orgId);
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!userId) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  if (userId === auth.userId) {
    return NextResponse.json(
      { error: 'An admin cannot remove themselves. Ask another org admin or support.' },
      { status: 400 },
    );
  }

  const removed = await removeOrgMember(orgId, userId, auth.userId);
  if (!removed.ok) {
    return NextResponse.json(
      { error: JOIN_ERROR_MESSAGES[removed.error_code], error_code: removed.error_code },
      { status: joinErrorStatus(removed.error_code) },
    );
  }
  return NextResponse.json({ success: true, keys_revoked: removed.keysRevoked });
}
