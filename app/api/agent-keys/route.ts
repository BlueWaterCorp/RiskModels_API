import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureStarterCredits } from '@/lib/agent/billing';
import { generateApiKey } from '@/lib/agent/api-keys';
import { sendEmail } from '@/lib/email-service';
import {
  formatExpiresAt,
  resolveRecipient,
} from '@/lib/agent/notify-expiring-api-keys';
import { API_TERMS_URL } from '@/emails/key-issued';

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

  try {
    await ensureStarterCredits(user.id);
  } catch (e) {
    console.error('[agent-keys] ensureStarterCredits failed:', e);
    return NextResponse.json(
      {
        error: 'Account setup failed',
        message:
          'Could not link your API key to a billing account. Please try again or contact support.',
      },
      { status: 500 },
    );
  }

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

  const { plainKey, hashedKey, prefix } = generateApiKey('live');

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
    .select('id, name, key_prefix, created_at, expires_at')
    .single();

  if (insertErr) {
    console.error('[agent-keys] insert error:', insertErr);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }

  const expiresAt = newKey.expires_at as string | null;
  if (expiresAt) {
    try {
      const recipient = await resolveRecipient(user.id);
      if (recipient?.email) {
        const createdAt = newKey.created_at as string | undefined;
        const sendResult = await sendEmail({
          to: recipient.email,
          subject:
            'RiskModels.app — 5-minute setup (whether you use Cursor/Claude or just Python)',
          template: 'key-issued',
          data: {
            firstName: recipient.name,
            keyName: newKey.name ?? 'API key',
            keyPrefix: newKey.key_prefix ?? 'rm_agent_',
            createdDateFormatted: createdAt
              ? formatExpiresAt(createdAt)
              : formatExpiresAt(new Date().toISOString()),
            expiresAtFormatted: formatExpiresAt(expiresAt),
            termsUrl: API_TERMS_URL,
          },
          userId: user.id,
        });
        if (!sendResult.success) {
          console.warn(
            '[agent-keys] key-issued email not sent:',
            sendResult.error ?? 'unknown',
          );
        }
      }
    } catch (e) {
      console.warn('[agent-keys] key-issued email failed:', e);
    }
  }

  return NextResponse.json({ success: true, key: { ...newKey, plainKey } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : null;
  const rawName = typeof body.name === 'string' ? body.name : null;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  if (rawName === null) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

  const name = rawName.trim();
  if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: 'Name too long (max 80 chars)' }, { status: 400 });

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from('agent_api_keys')
    .update({ name })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name')
    .single();

  if (error || !updated) {
    console.error('[agent-keys] rename error:', error);
    return NextResponse.json({ error: 'Failed to rename key' }, { status: 500 });
  }

  return NextResponse.json({ success: true, key: updated });
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
