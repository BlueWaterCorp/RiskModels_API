/**
 * Who receives an edition of the feed (Event Ledger editions included).
 *
 * feed_waitlist_edition_recipients() (migrations 20261102200000, replaced by
 * 20261113120000) is the single source of truth, so the rule lives in one place:
 *   - a confirmed, subscribed contact receives editions at its own address, unless
 *     deliver_to_contact is false AND a linked delivery address has confirmed;
 *   - confirmed, subscribed delivery addresses linked to a live contact receive
 *     editions;
 *   - one row per address, so a shared team mailbox gets one copy.
 * Each recipient carries its own unsubscribe token for the edition footer.
 * Relationship emails (welcome, launch notice) go to contact rows only; see
 * feedEmailRecipient() in lib/feed-email.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FeedEditionRecipient {
  email: string;
  unsubscribe_token: string;
  /** Since migration 20261113120000: 'contact' or 'feed' (a delivery inbox), for the edition footer. */
  purpose?: "contact" | "feed";
  /** Since migration 20261113120000: the code in this recipient's "Forward to a colleague" link. */
  referral_code?: string;
}

export async function listFeedEditionRecipients(): Promise<FeedEditionRecipient[]> {
  const { data, error } = await createAdminClient().rpc("feed_waitlist_edition_recipients");
  // A fixed message: upstream text can quote an address.
  if (error) throw new Error("feed_recipients_failed");
  return Array.isArray(data) ? (data as FeedEditionRecipient[]) : [];
}
