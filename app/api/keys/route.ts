import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateUserApiKey } from '@/lib/user-api-keys';

const MAX_KEYS = 10;

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: keys, error } = await supabase
    .from('user_generated_api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch keys' }, { status: 500 });
  }

  const now = new Date();
  const keysWithStatus = (keys ?? []).map((k) => ({
    ...k,
    status: k.expires_at && new Date(k.expires_at) < now ? 'expired' : 'active',
  }));

  return NextResponse.json({ keys: keysWithStatus, maxAllowed: MAX_KEYS });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = (body.name as string)?.trim() || 'My API Key';

  // Check limit
  const { count } = await supabase
    .from('user_generated_api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null);

  if ((count ?? 0) >= MAX_KEYS) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_KEYS} active keys reached. Revoke one first.` },
      { status: 429 },
    );
  }

  const { plainKey, hashedKey, prefix } = generateUserApiKey();

  const { data: newKey, error: insertError } = await supabase
    .from('user_generated_api_keys')
    .insert({
      user_id: user.id,
      key_hash: hashedKey,
      key_prefix: prefix,
      name,
      scopes: ['read'],
    })
    .select('id, name, key_prefix, scopes, created_at')
    .single();

  if (insertError) {
    console.error('[keys] insert error:', insertError);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, key: { ...newKey, plainKey } },
    { status: 201 },
  );
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'Missing key id' }, { status: 400 });

  const { error } = await supabase
    .from('user_generated_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
