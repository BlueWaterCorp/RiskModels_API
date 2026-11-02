/**
 * Email for the security master feed early-access list (public.feed_waitlist).
 *
 * - sendFeedEarlyAccessEmail: called by POST /api/feed-waitlist for a NEW row
 *   with consent_feed_emails = true. Never for a repeat signup.
 * - sendFeedLaunchNotice: for an operator-run batch when the first edition is
 *   published. Callers must select only rows with consent_feed_emails = true and
 *   unsubscribed_at is null; feedEmailRecipient() applies that filter.
 *
 * Every message carries the row's unsubscribe link in the footer and in the
 * List-Unsubscribe header, with RFC 8058 one-click support
 * (POST /api/feed-waitlist/unsubscribe).
 */

import { Resend } from "resend";
import { render } from "@react-email/render";
import { sendResendEmail } from "@/lib/resend-audit";
import { CANONICAL_SITE_URL } from "@/lib/constants";
import { DEFAULT_RESEND_FROM, SUPPORT_EMAIL } from "@/emails/constants";
import { FeedEarlyAccessEmail, FEED_EARLY_ACCESS_SUBJECT } from "@/emails/feed-early-access";
import {
  FeedLaunchNoticeEmail,
  feedLaunchNoticeSubject,
  type FeedLaunchNoticeEmailProps,
} from "@/emails/feed-launch-notice";

export const FEED_PAGE_URL = `${CANONICAL_SITE_URL}/security-master-feed`;

/** Human page: shows a confirm button, so link scanners cannot unsubscribe anyone. */
export function feedUnsubscribePageUrl(token: string): string {
  return `${FEED_PAGE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** RFC 8058 one-click endpoint used by mail clients from the List-Unsubscribe header. */
export function feedUnsubscribeOneClickUrl(token: string): string {
  return `${CANONICAL_SITE_URL}/api/feed-waitlist/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function feedUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${feedUnsubscribeOneClickUrl(token)}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe%20feed>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface FeedWaitlistRow {
  email: string;
  name: string | null;
  consent_feed_emails: boolean;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
}

/** True when a row may receive feed email: consented and not unsubscribed. */
export function feedEmailRecipient(row: FeedWaitlistRow): boolean {
  return row.consent_feed_emails === true && !row.unsubscribed_at && Boolean(row.unsubscribe_token);
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_RESEND_FROM;
}

function resendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY || "");
}

export async function sendFeedEarlyAccessEmail(row: FeedWaitlistRow): Promise<{ id: string } | null> {
  if (!feedEmailRecipient(row)) return null;
  const html = await render(
    FeedEarlyAccessEmail({
      name: row.name,
      feedPageUrl: FEED_PAGE_URL,
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
    }),
  );
  const sent = await sendResendEmail(resendClient(), {
    from: fromAddress(),
    to: row.email,
    replyTo: SUPPORT_EMAIL,
    subject: FEED_EARLY_ACCESS_SUBJECT,
    html,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_early_access" }],
  });
  return { id: sent.id };
}

export type FeedLaunchNoticeInput = Omit<FeedLaunchNoticeEmailProps, "name" | "unsubscribeUrl">;

export async function sendFeedLaunchNotice(
  row: FeedWaitlistRow,
  input: FeedLaunchNoticeInput,
): Promise<{ id: string } | null> {
  if (!feedEmailRecipient(row)) return null;
  const html = await render(
    FeedLaunchNoticeEmail({
      ...input,
      name: row.name,
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
    }),
  );
  const sent = await sendResendEmail(resendClient(), {
    from: fromAddress(),
    to: row.email,
    replyTo: SUPPORT_EMAIL,
    subject: feedLaunchNoticeSubject(input.firstEditionDate),
    html,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_launch_notice" }],
  });
  return { id: sent.id };
}
