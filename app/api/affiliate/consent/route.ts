import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Latest affiliate-program terms version. Bump when the doc at
 * riskmodels.net/terms/affiliate gets meaningful changes that require
 * fresh consent. Only this string and the column it writes need updating.
 */
const TERMS_VERSION = 'v1.1';

/**
 * Active re-consent endpoint for chart-watermark attribution terms.
 *
 * Body: { accept: boolean, version?: string }
 *   accept=true  → stamps affiliates.consent_v1_at = now()
 *   accept=false → clears consent_v1_at (opt-out, watermarks suppressed)
 *
 * Scoped to the requester's own affiliate row only. 401 unauth, 404 if
 * the user isn't an affiliate, 400 on missing body. Mirrors the Path A
 * email-reply consent flow described in docs/legal/affiliate-program-v1.md.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { accept?: unknown; version?: unknown };
  try {
    body = (await request.json()) as { accept?: unknown; version?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.accept !== 'boolean') {
    return NextResponse.json(
      { error: '`accept` (boolean) is required' },
      { status: 400 },
    );
  }

  /** Defensive: explicitly ignore mismatched version strings. Forces clients
   *  to refresh and re-fetch the dashboard if we've shipped a newer terms
   *  version since they loaded the page (avoids stale-tab consent races). */
  const sentVersion = typeof body.version === 'string' ? body.version : null;
  if (sentVersion && sentVersion !== TERMS_VERSION) {
    return NextResponse.json(
      {
        error: 'Terms version mismatch',
        message: `You attempted to consent to ${sentVersion}, but the current version is ${TERMS_VERSION}. Refresh the page and try again.`,
      },
      { status: 409 },
    );
  }

  const admin = createAdminClient();

  const { data: affRow } = await admin
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!affRow) {
    /** Same 404 envelope as /api/affiliate/me — don't leak existence. */
    return NextResponse.json({ error: 'Not an affiliate' }, { status: 404 });
  }

  const consentAt = body.accept ? new Date().toISOString() : null;
  const { error: updErr } = await admin
    .from('affiliates')
    .update({ consent_v1_at: consentAt })
    .eq('id', affRow.id);
  if (updErr) {
    console.error('[affiliate/consent] update failed:', updErr);
    return NextResponse.json(
      { error: 'Failed to record consent' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    accepted: body.accept,
    version: TERMS_VERSION,
    consent_v1_at: consentAt,
  });
}
