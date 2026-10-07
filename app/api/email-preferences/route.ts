import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))
    return NextResponse.json({ error: 'Invalid preference link.' }, { status: 400 });
  const { error } = await createAdminClient().from('api_email_engagement')
    .update({ paused_at: new Date().toISOString(), pause_reason: 'unsubscribed' }).eq('unsubscribe_token', token);
  if (error) return NextResponse.json({ error: 'Could not save. Please reply to the email for help.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
