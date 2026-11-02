/**
 * Who receives an edition of the security master feed.
 *
 * feed_waitlist_edition_recipients() (migration 20261102200000) is the single
 * source of truth, so the rule lives in one place:
 *   - a confirmed, subscribed contact with NO delivery address receives editions
 *     at its own address;
 *   - a contact WITH a delivery address never receives editions at the contact
 *     address; the editions go to the confirmed, subscribed delivery addresses
 *     linked to a live contact;
 *   - one row per address, so a shared team mailbox gets one copy.
 * Each recipient carries its own unsubscribe token for the edition footer.
 * Relationship emails (welcome, launch notice) go to contact rows only; see
 * feedEmailRecipient() in lib/feed-email.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FeedEditionRecipient {
  email: string;
  unsubscribe_token: string;
}

export async function listFeedEditionRecipients(): Promise<FeedEditionRecipient[]> {
  const { data, error } = await createAdminClient().rpc("feed_waitlist_edition_recipients");
  // A fixed message: upstream text can quote an address.
  if (error) throw new Error("feed_recipients_failed");
  return Array.isArray(data) ? (data as FeedEditionRecipient[]) : [];
}
