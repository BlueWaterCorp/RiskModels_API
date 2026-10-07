import { NextRequest, NextResponse } from 'next/server';
import { authorized } from '@/lib/engagement-auth';
import { engagementQueue, sendEngagement } from '@/lib/email-engagement';
import { nextEngagement, engagementCopy } from '@/emails/engagement-content';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await engagementQueue();
    return NextResponse.json({ mode: 'review', accounts: rows.map(a => {
      const kind = nextEngagement(a);
      return { ...a, next_kind: kind, draft: kind ? engagementCopy(a,kind) : null };
    }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not load engagement queue.' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.user_id) || typeof body.kind !== 'string' || typeof body.expected_text !== 'string' || body.expected_text.length > 10000)
    return NextResponse.json({ error: 'Invalid account or message kind.' }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...await sendEngagement(body.user_id, body.kind, body.expected_text) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed.' }, { status: 409 }); }
}
