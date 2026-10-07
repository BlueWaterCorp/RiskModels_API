import { NextRequest, NextResponse } from 'next/server';
import { authorized } from '@/lib/engagement-auth';
import { engagementQueue, sendEngagementDigest } from '@/lib/email-engagement';
import { nextEngagement } from '@/emails/engagement-content';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.EMAIL_ENGAGEMENT_ENABLED !== 'true') return NextResponse.json({ enabled: false, mode: 'review' });
  try {
    const accounts = await engagementQueue();
    const ready = accounts.filter(a => nextEngagement(a));
    const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';
    const digest = dryRun ? null : await sendEngagementDigest(accounts);
    return NextResponse.json({ enabled: true, mode: 'review', accounts: accounts.length, ready: ready.length, customer_emails_sent: 0, digest });
  } catch (error) {
    console.error('[email-engagement] queue refresh failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Engagement queue refresh failed.' }, { status: 500 });
  }
}
