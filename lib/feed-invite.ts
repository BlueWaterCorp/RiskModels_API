/**
 * Personal invitations to the security master feed.
 *
 * inviteToFeedWaitlist() is for the case where a named person adds someone's
 * address by hand and wants them to see the feed. It stores a row with
 * source = "invite", invited_by and invited_at, consent_feed_emails = false,
 * and sends the one-time invitation (emails/feed-invite.tsx). Nothing else is
 * sent to that address unless the person joins through the early-access form
 * (POST /api/feed-waitlist, which records the consent) or replies yes.
 *
 * Outcomes:
 *   sent             a new row was stored and the invitation was sent
 *   already_on_list  the address has already joined (consent recorded)
 *   already_invited  the address was invited before; no second invitation
 *   unsubscribed     the address unsubscribed; never emailed again
 *   invalid_email    not a plausible email address
 *   dry_run          would have been sent; nothing was written or sent
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendFeedInvite, type FeedInviteInput } from "@/lib/feed-email";

export type FeedInviteOutcome =
  | "sent"
  | "already_on_list"
  | "already_invited"
  | "unsubscribed"
  | "invalid_email"
  | "dry_run";

export interface InviteToFeedInput extends FeedInviteInput {
  email: string;
  name?: string | null;
  /** Write nothing and send nothing; report what would happen. */
  dryRun?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 200;
const ROW_COLUMNS =
  "email, name, consent_feed_emails, unsubscribe_token, unsubscribed_at, invited_at";

interface ExistingRow {
  email: string;
  name: string | null;
  consent_feed_emails: boolean;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
  invited_at: string | null;
}

function text(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, MAX_TEXT) : null;
}

export async function inviteToFeedWaitlist(input: InviteToFeedInput): Promise<FeedInviteOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "invalid_email";

  const admin = createAdminClient();

  const { data: existing, error: readErr } = await admin
    .from("feed_waitlist")
    .select(ROW_COLUMNS)
    .eq("email", email)
    .maybeSingle();
  if (readErr) throw new Error("feed_invite_read_failed");

  const row = existing as ExistingRow | null;
  if (row) {
    if (row.unsubscribed_at) return "unsubscribed";
    if (row.consent_feed_emails) return "already_on_list";
    if (row.invited_at) return "already_invited";
  }
  if (input.dryRun) return "dry_run";

  let target: ExistingRow;
  if (row) {
    // On the table from a signup without consent: record the invitation on that row.
    const { data, error } = await admin
      .from("feed_waitlist")
      .update({ invited_by: text(input.inviterName), invited_at: new Date().toISOString() })
      .eq("email", email)
      .select(ROW_COLUMNS)
      .single();
    if (error || !data) throw new Error("feed_invite_update_failed");
    target = data as ExistingRow;
  } else {
    const { data, error } = await admin
      .from("feed_waitlist")
      .insert({
        email,
        name: text(input.name),
        source: "invite",
        invited_by: text(input.inviterName),
        invited_at: new Date().toISOString(),
        consent_feed_emails: false,
      })
      .select(ROW_COLUMNS)
      .single();
    if (error || !data) throw new Error("feed_invite_insert_failed");
    target = data as ExistingRow;
  }

  const sent = await sendFeedInvite(target, {
    inviterName: input.inviterName,
    inviterRole: input.inviterRole,
    note: input.note,
  });
  return sent ? "sent" : "unsubscribed";
}
