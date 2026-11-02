/**
 * Personal invitations to the security master feed.
 *
 * inviteToFeedWaitlist() is for the case where a named person adds someone's
 * address by hand and wants them to see the feed. It stores a row with
 * source = "invite" and consent_feed_emails = false, and sends the one-time
 * invitation (emails/feed-invite.tsx). Nothing else is sent to that address
 * unless the person joins through the early-access form and confirms their
 * address (double opt-in, see app/api/feed-waitlist), or replies yes.
 *
 * Exactly once. Two runs for the same address cannot both send:
 *   1. feed_waitlist_claim_invite() is one atomic UPDATE that sets
 *      invite_claimed_at and a fresh invite_claim_id, and matches nothing if the
 *      row is consented, unsubscribed, already invited, or claimed in the last
 *      15 minutes. The claim id comes back to this run.
 *   2. The send carries an idempotency key built from the row id, so a retry
 *      after a crash between the send and step 3 is deduplicated by the provider.
 *   3. invited_at is set only after the provider accepts the message. A failed
 *      send releases the claim so it can be retried.
 * Both the release and the mark match THIS run's claim id. A run whose claim went
 * stale and was retaken by another run therefore cannot clear or complete the
 * newer run's claim; its updates match no row.
 *
 * Outcomes:
 *   sent             the invitation was sent
 *   already_on_list  the address has already joined (consent recorded)
 *   already_invited  the address was invited before; no second invitation
 *   in_progress      another run holds the claim right now
 *   unsubscribed     the address unsubscribed; never emailed again
 *   invalid_email    not a plausible email address
 *   dry_run          would have been sent; nothing was written or sent
 *
 * Failures throw FeedInviteError with a fixed event name. Upstream messages are
 * never exposed: they can quote the address or a token.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendFeedInvite, type FeedInviteInput } from "@/lib/feed-email";

export type FeedInviteOutcome =
  | "sent"
  | "already_on_list"
  | "already_invited"
  | "in_progress"
  | "unsubscribed"
  | "invalid_email"
  | "dry_run";

export type FeedInviteEvent =
  | "read_failed"
  | "insert_failed"
  | "claim_failed"
  | "send_failed"
  | "release_failed"
  | "mark_failed";

export class FeedInviteError extends Error {
  readonly event: FeedInviteEvent;
  constructor(event: FeedInviteEvent) {
    super(`feed_invite_${event}`);
    this.name = "FeedInviteError";
    this.event = event;
  }
}

export interface InviteToFeedInput extends FeedInviteInput {
  email: string;
  name?: string | null;
  /** Write nothing and send nothing; report what would happen. */
  dryRun?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 200;
/** A claim older than this is treated as a crashed run and may be retaken. */
export const INVITE_CLAIM_STALE_SECONDS = 15 * 60;
const STATE_COLUMNS = "consent_feed_emails, unsubscribed_at, invited_at";

interface StateRow {
  consent_feed_emails: boolean;
  unsubscribed_at: string | null;
  invited_at: string | null;
}

interface ClaimedRow {
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
  /** Identifies this run's claim; the release and the mark must match it. */
  claim_id: string;
}

function text(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, MAX_TEXT) : null;
}

function outcomeFor(row: StateRow | null): FeedInviteOutcome | null {
  if (!row) return null;
  if (row.unsubscribed_at) return "unsubscribed";
  if (row.consent_feed_emails) return "already_on_list";
  if (row.invited_at) return "already_invited";
  return null;
}

export async function inviteToFeedWaitlist(input: InviteToFeedInput): Promise<FeedInviteOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "invalid_email";

  const admin = createAdminClient();

  const read = async (): Promise<StateRow | null> => {
    const { data, error } = await admin.from("feed_waitlist").select(STATE_COLUMNS).eq("email", email).maybeSingle();
    if (error) throw new FeedInviteError("read_failed");
    return (data as StateRow | null) ?? null;
  };

  const before = await read();
  const settled = outcomeFor(before);
  if (settled) return settled;
  if (input.dryRun) return "dry_run";

  if (!before) {
    // Race-safe: a concurrent run inserting the same address is a no-op here.
    const { error } = await admin.from("feed_waitlist").upsert(
      { email, name: text(input.name), source: "invite", consent_feed_emails: false },
      { onConflict: "email", ignoreDuplicates: true },
    );
    if (error) throw new FeedInviteError("insert_failed");
  }

  const { data: claimedRows, error: claimError } = await admin.rpc("feed_waitlist_claim_invite", {
    p_email: email,
    p_invited_by: text(input.inviterName),
    p_stale_seconds: INVITE_CLAIM_STALE_SECONDS,
  });
  if (claimError) throw new FeedInviteError("claim_failed");

  const claimed = Array.isArray(claimedRows) && claimedRows.length > 0 ? (claimedRows[0] as ClaimedRow) : null;
  if (!claimed) {
    // Lost the race, or the row settled between the read and the claim.
    return outcomeFor(await read()) ?? "in_progress";
  }

  try {
    await sendFeedInvite(
      { id: claimed.id, email: claimed.email, name: claimed.name, unsubscribe_token: claimed.unsubscribe_token, unsubscribed_at: null },
      { inviterName: input.inviterName, inviterRole: input.inviterRole, note: input.note },
    );
  } catch {
    // Release THIS run's claim so the invitation can be retried. If the claim went stale and another
    // run retook it, the claim id no longer matches, nothing is updated, and the newer claim is untouched.
    const { error } = await admin
      .from("feed_waitlist")
      .update({ invite_claimed_at: null, invite_claim_id: null })
      .eq("email", email)
      .eq("invite_claim_id", claimed.claim_id)
      .is("invited_at", null)
      .select("email");
    throw new FeedInviteError(error ? "release_failed" : "send_failed");
  }

  // Mark THIS run's claim sent. If another run retook a stale claim, nothing matches here: the provider
  // accepted this message under the row's idempotency key, so it is delivered once, and the run that
  // holds the claim records it.
  const { error: markError } = await admin
    .from("feed_waitlist")
    .update({ invited_at: new Date().toISOString(), invite_claimed_at: null, invite_claim_id: null })
    .eq("email", email)
    .eq("invite_claim_id", claimed.claim_id)
    .is("invited_at", null)
    .select("email");
  if (markError) throw new FeedInviteError("mark_failed");

  return "sent";
}
