/**
 * POST /api/account/delete-request — the signed-in user asks for their account
 * to be deleted (privacy policy §5).
 *
 * Immediate, in this request: every API key and connector refresh token is
 * revoked and auto top-up is switched off, so the account stops being usable
 * and stops being charged. The erase itself (auth user, profile, saved
 * portfolios) is done by the operator within 30 days, keeping the billing and
 * tax records the policy says we keep; this route emails service@ with the
 * request and confirms to the user.
 *
 * Body: { "confirm": "DELETE" }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withResendAuditBcc } from '@/lib/resend-audit';

const OPS_INBOX = 'service@riskmodels.app';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { confirm } = await request.json().catch(() => ({}));
  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Send {"confirm":"DELETE"} to request account deletion.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const failures: string[] = [];

  const revoke = async (table: string) => {
    const { error } = await admin.from(table).update({ revoked_at: now }).eq('user_id', user.id).is('revoked_at', null);
    if (error) failures.push(`${table}: ${error.message}`);
  };
  await revoke('user_generated_api_keys');
  await revoke('agent_api_keys');
  await revoke('oauth_refresh_tokens');

  const { error: refillErr } = await admin.from('agent_accounts').update({ auto_top_up: false }).eq('user_id', user.id);
  if (refillErr) failures.push(`agent_accounts: ${refillErr.message}`);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) failures.push('email: RESEND_API_KEY not set');
  else {
    const resend = new Resend(apiKey);
    const opsText = [
      'Account deletion requested on riskmodels.app.',
      `User id: ${user.id}`,
      `Email: ${user.email ?? '(none)'}`,
      `Requested: ${now}`,
      `Keys, connector tokens and auto top-up: ${failures.length ? 'PARTIAL, see below' : 'revoked / off'}`,
      ...failures,
      '',
      'Erase the account within 30 days (privacy policy section 5), keeping billing and tax records.',
    ].join('\n');
    const ops = await resend.emails.send(withResendAuditBcc({
      from: 'RiskModels <service@riskmodels.app>', to: OPS_INBOX,
      subject: `Account deletion request: ${user.email ?? user.id}`, text: opsText,
    }), { idempotencyKey: `account-delete/${user.id}/${now.slice(0, 10)}` });
    if (ops.error) failures.push(`ops email: ${ops.error.message}`);

    if (user.email) {
      const conf = await resend.emails.send(withResendAuditBcc({
        from: 'RiskModels <service@riskmodels.app>', to: user.email, replyTo: OPS_INBOX,
        subject: 'Your RiskModels account deletion request',
        text: [
          'We received your request to delete your RiskModels account.',
          '',
          'Your API keys and connector sign-ins have been revoked and auto top-up is off, so nothing more will be charged.',
          'We will delete your account data within 30 days. Billing and tax records are kept as long as the law requires.',
          '',
          `If you did not ask for this, reply to this email or write to ${OPS_INBOX}.`,
        ].join('\n'),
      }), { idempotencyKey: `account-delete-confirm/${user.id}/${now.slice(0, 10)}` });
      if (conf.error) failures.push(`confirmation email: ${conf.error.message}`);
    }
  }

  if (failures.length) {
    console.error('[account/delete-request]', user.id, failures);
    return NextResponse.json(
      { ok: false, error: `Part of the request failed. Email ${OPS_INBOX} to finish it.` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
