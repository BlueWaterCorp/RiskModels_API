import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateUserApiKey } from '@/lib/user-api-keys';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: keys } = await admin
    .from('agent_api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const now = new Date();
  const keysWithStatus = (keys ?? []).map((k) => ({
    ...k,
    status: k.revoked_at
      ? 'revoked'
      : k.expires_at && new Date(k.expires_at) < now
      ? 'expired'
      : 'active',
  }));

  return NextResponse.json({ keys: keysWithStatus });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const admin = createAdminClient();

  // Auto-number if no name given: "API Key 1", "API Key 2", etc.
  let name = (body.name as string)?.trim();
  if (!name) {
    const { count } = await admin
      .from('agent_api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    name = `API Key ${(count ?? 0) + 1}`;
  }

  const { plainKey, hashedKey, prefix } = generateUserApiKey('live');

  const { data: newKey, error: insertErr } = await admin
    .from('agent_api_keys')
    .insert({
      user_id: user.id,
      key_hash: hashedKey,
      key_prefix: prefix,
      name,
      scopes: ['*'],
      rate_limit_per_minute: 60,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id, name, key_prefix, created_at')
    .single();

  if (insertErr) {
    console.error('[agent-keys] insert error:', insertErr);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }

  return NextResponse.json({ success: true, key: { ...newKey, plainKey } }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('agent_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
  return NextResponse.json({ success: true });
}
