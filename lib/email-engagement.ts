import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { withResendAuditBcc } from '@/lib/resend-audit';
import { greetingName, engagementCopy, nextEngagement, parseWorkflow, parseAgentClient,
  type EngagementAccount, type EngagementKind } from '@/emails/engagement-content';

export async function enrollEngagement() {
  const { error } = await createAdminClient().rpc('enroll_api_email_engagement');
  if (error) throw new Error(`Engagement enrollment: ${error.message}`);
}

export async function saveSetup(userId: string, workflow: unknown, agentClient: unknown) {
  await enrollEngagement();
  const admin = createAdminClient();
  const choice = parseWorkflow(workflow);
  if (choice) {
    const { error } = await admin.from('api_email_engagement').update({
      workflow: choice, agent_client: choice === 'agent' ? parseAgentClient(agentClient) : null,
    }).eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
  const { data, error } = await admin.from('api_email_engagement')
    .select('workflow,agent_client,started_at,paused_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function engagementQueue() {
  await enrollEngagement();
  const { data, error } = await createAdminClient().from('api_email_engagement_queue')
    .select('*').eq('excluded', false).order('started_at', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EngagementAccount[];
}

async function loadAccount(userId: string) {
  const { data, error } = await createAdminClient().from('api_email_engagement_queue')
    .select('*').eq('user_id', userId).single();
  if (error) throw new Error(error.message);
  return data as EngagementAccount;
}

/** Human-reviewed sends. No cron sends customer follow-ups in this release. */
export async function sendEngagement(userId: string, kind: EngagementKind, expectedText: string) {
  const admin = createAdminClient();
  const before = await loadAccount(userId);
  if (nextEngagement(before) !== kind) throw new Error('Account activity changed. Refresh the queue before sending.');
  if (engagementCopy(before, kind).text !== expectedText) throw new Error('Draft changed. Refresh and review the current message.');
  const { data: auth, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !auth.user?.email || !auth.user.email_confirmed_at)
    throw new Error('A verified account email is required.');
  // Never send to an arbitrary address supplied by a client or editable profile.
  if (auth.user.email.toLowerCase() !== before.email?.toLowerCase())
    throw new Error('Account email changed. Resolve the account email before sending.');
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  const { data: messageId, error: claimError } = await admin.rpc('claim_api_email_engagement', {
    p_user_id: userId, p_kind: kind,
  });
  if (claimError) throw new Error(claimError.message);
  if (!messageId) throw new Error('A message is already pending, or this account is paused or recently contacted.');
  let providerAttempted = false;
  try {
    const fresh = await loadAccount(userId);
    // Ignore only our own reservation, keeping all activity and suppression checks.
    if (nextEngagement({ ...fresh, has_pending_send: false }) !== kind) {
      await admin.from('api_email_engagement_messages').update({ status: 'cancelled' }).eq('id', messageId);
      throw new Error('Account activity changed before sending.');
    }
    const { data: prefs, error: prefsError } = await admin.from('api_email_engagement')
      .select('unsubscribe_token,paused_at,last_reply_at').eq('user_id', userId).single();
    if (prefsError || prefs.paused_at || prefs.last_reply_at) throw new Error('Account follow-ups are paused.');
    const copy = engagementCopy(fresh, kind);
    if (copy.text !== expectedText) throw new Error('Draft changed before sending. Refresh the queue.');
    const unsubscribeUrl = `https://riskmodels.app/email-preferences?token=${prefs.unsubscribe_token}`;
    const text = `${copy.text}\n\nPause setup follow-ups: ${unsubscribeUrl}`;
    const saved = await admin.from('api_email_engagement_messages')
      .update({ subject: copy.subject, body: text }).eq('id', messageId);
    if (saved.error) throw new Error(saved.error.message);
    providerAttempted = true;
    const result = await new Resend(apiKey).emails.send(withResendAuditBcc({
      from: 'Conrad at RiskModels <service@riskmodels.app>', to: auth.user.email,
      replyTo: 'conrad@bwmacro.com', subject: copy.subject, text,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
    }), { idempotencyKey: `engagement/${messageId}` });
    if (result.error || !result.data?.id) throw new Error(result.error?.message ?? 'Email acceptance is uncertain.');
    const sentAt = new Date().toISOString();
    const sent = await admin.from('api_email_engagement_messages').update({
      status: 'sent', sent_at: sentAt, provider_message_id: result.data.id,
    }).eq('id', messageId);
    if (sent.error) throw new Error('Email accepted; delivery record needs reconciliation.');
    const contacted = await admin.from('api_email_engagement').update({ last_contact_at: sentAt }).eq('user_id', userId);
    if (contacted.error) throw new Error('Email accepted; contact timestamp needs reconciliation.');
    return { messageId: result.data.id };
  } catch (error) {
    // Known pre-send aborts can be reviewed again. Only attempted deliveries need reconciliation.
    await admin.from('api_email_engagement_messages').update({ status: providerAttempted ? 'failed' : 'cancelled', error: error instanceof Error ? error.message : 'Send failed' })
      .eq('id', messageId).eq('status', 'claimed');
    throw error;
  }
}

export async function sendEngagementDigest(accounts: EngagementAccount[]) {
  const counts: Record<string, number> = {};
  for (const a of accounts) { const kind = nextEngagement(a); if (kind) counts[kind] = (counts[kind] ?? 0) + 1; }
  if (!Object.keys(counts).length) return { sent: false, reason: 'No accounts need follow-up.' };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  const admin = createAdminClient();
  const date = new Date().toISOString().slice(0, 10);
  const claim = await admin.from('api_email_engagement_reports').insert({ report_date: date });
  if (claim.error?.code === '23505') return { sent: false, reason: 'Today’s digest is already recorded.' };
  if (claim.error) throw new Error(claim.error.message);
  const queueUrl = process.env.ENGAGEMENT_ADMIN_URL || 'http://localhost:3001/admin/engagement';
  const result = await new Resend(apiKey).emails.send(withResendAuditBcc({
    from: 'RiskModels <service@riskmodels.app>', to: 'conrad@bwmacro.com',
    subject: 'RiskModels activation queue',
    text: `Accounts ready for review:\n\n${Object.entries(counts).map(([k,v]) => `${k}: ${v}`).join('\n')}\n\nReview drafts and send individually: ${queueUrl}\n\nMark any customer reply as Replied in the queue to stop follow-ups. No customer emails were sent by this digest.`,
  }), { idempotencyKey: `engagement-digest/${date}` });
  const updated = await admin.from('api_email_engagement_reports').update({
    status: result.error ? 'failed' : 'sent', provider_message_id: result.data?.id,
  }).eq('report_date', date);
  if (result.error || updated.error) throw new Error(result.error?.message ?? updated.error?.message);
  return { sent: true, counts };
}

/** Called after a first OAuth token response; refreshing tokens never repeats this welcome. */
export async function welcomeOAuthUser(userId: string, createdAt: string) {
  const setup = await saveSetup(userId, undefined, undefined);
  if (!setup || Date.parse(setup.started_at) !== Date.parse(createdAt)) return;
  const admin = createAdminClient();
  const { data: auth } = await admin.auth.admin.getUserById(userId);
  if (!auth.user?.email || !auth.user.email_confirmed_at) return;
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const { sendEmail } = await import('@/lib/email-service');
  await sendEmail({ to: auth.user.email, subject: 'Your first RiskModels analysis', template: 'key-issued', userId,
    data: { firstName: greetingName(profile?.full_name), keyName: 'Assistant connection', keyPrefix: '',
      createdDateFormatted: '', expiresAtFormatted: '', termsUrl: 'https://riskmodels.net/terms/api',
      workflow: 'agent', agentClient: parseAgentClient(setup.agent_client), isFirstKey: true, connected: true },
  });
}
