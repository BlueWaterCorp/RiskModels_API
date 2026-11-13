/**
 * Email for the security master feed early-access list (public.feed_waitlist).
 *
 * - sendFeedConfirmation: double opt-in. Sent to the address given on the
 *   early-access form; consent is recorded only when its link is confirmed
 *   (POST /api/feed-waitlist/confirm).
 * - sendFeedEarlyAccessEmail: sent once, after the owner confirms. Never for a
 *   repeat signup.
 * - sendFeedLaunchNotice: for an operator-run batch when the first edition is
 *   published. Callers must select only rows with consent_feed_emails = true and
 *   unsubscribed_at is null; feedEmailRecipient() applies that filter.
 * - sendFeedInvite: one-time personal invitation to an address a named person
 *   added by hand (lib/feed-invite.ts). The row is not consented; this is the
 *   only message it receives unless the person joins.
 *
 * Every message carries the row's unsubscribe link in the footer and in the
 * List-Unsubscribe header, with RFC 8058 one-click support
 * (POST /api/feed-waitlist/unsubscribe), an HTML part and a plain-text part,
 * and the machine-readable feed descriptor in both.
 */

import { Resend } from "resend";
import { render } from "@react-email/render";
import { sendResendEmail } from "@/lib/resend-audit";
import { CANONICAL_SITE_URL } from "@/lib/constants";
import { FEED_PAGE_URL } from "@/lib/feed-descriptor";
import { DEFAULT_RESEND_FROM, SUPPORT_EMAIL } from "@/emails/constants";
import { FeedEarlyAccessEmail, FEED_EARLY_ACCESS_SUBJECT } from "@/emails/feed-early-access";
import { FeedConfirmEmail, FEED_CONFIRM_SUBJECT } from "@/emails/feed-confirm";
import { FeedDeliveryConfirmEmail, FEED_DELIVERY_CONFIRM_SUBJECT } from "@/emails/feed-delivery-confirm";
import {
  FeedLaunchNoticeEmail,
  feedLaunchNoticeSubject,
  type FeedLaunchNoticeEmailProps,
} from "@/emails/feed-launch-notice";
import { FeedInviteEmail, feedInviteSubject } from "@/emails/feed-invite";
import { FeedDeliveryChangeEmail, FEED_DELIVERY_CHANGE_SUBJECT } from "@/emails/feed-delivery-change";

export { FEED_PAGE_URL };

/** Token only: the inbox is named in the email text, and the server acts on the inbox stored with the request. */
export function feedDeliveryChangeConfirmPageUrl(token: string): string {
  return `${FEED_PAGE_URL}/delivery/confirm?token=${encodeURIComponent(token)}`;
}

/**
 * Team-inbox request from an edition footer: asks the CONTACT (never the inbox) to confirm. The inbox and
 * the stop choice named here are the ones stored on the row by feed_waitlist_claim_delivery_change.
 */
export async function sendFeedDeliveryChangeConfirmation(
  row: { email: string; name: string | null; unsubscribe_token: string },
  token: string,
  change: { inbox: string; stopContact: boolean; requestedBy?: "footer" | "operator" },
): Promise<{ id: string }> {
  const { html, text } = await renderBoth(
    FeedDeliveryChangeEmail({
      name: row.name,
      inbox: change.inbox,
      stopContact: change.stopContact,
      requestedBy: change.requestedBy ?? "footer",
      confirmUrl: feedDeliveryChangeConfirmPageUrl(token),
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
    }),
  );
  const sent = await sendResendEmail(resendClient(), {
    from: fromAddress(),
    to: row.email,
    replyTo: SUPPORT_EMAIL,
    subject: FEED_DELIVERY_CHANGE_SUBJECT,
    html,
    text,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_delivery_change" }],
  });
  return { id: sent.id };
}

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
  /** 'contact' (default) receives relationship email; 'feed' is a delivery address and receives editions only. */
  purpose?: "contact" | "feed";
}

/**
 * True when a row may receive relationship feed email (welcome, launch notice): consented, not
 * unsubscribed, and not a delivery-only address. Editions go to feed_waitlist_edition_recipients().
 */
export function feedEmailRecipient(row: FeedWaitlistRow): boolean {
  return (
    row.consent_feed_emails === true &&
    !row.unsubscribed_at &&
    Boolean(row.unsubscribe_token) &&
    row.purpose !== "feed"
  );
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_RESEND_FROM;
}

function resendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY || "");
}

async function renderBoth(element: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

/** A row that may receive a confirmation request: not unsubscribed, has an unsubscribe token. */
export interface FeedConfirmRow {
  email: string;
  name: string | null;
  unsubscribe_token: string;
  /** The delivery address STORED on the row, if any. The confirmation email names this one, never a request's. */
  requested_feed_email?: string | null;
  /** The marketing choice the pending claim will apply on confirmation (migration 20261113120000). */
  marketing_opt_in?: boolean | null;
}

export function feedConfirmPageUrl(token: string): string {
  return `${FEED_PAGE_URL}/confirm?token=${encodeURIComponent(token)}`;
}

export async function sendFeedConfirmation(
  row: FeedConfirmRow,
  token: string,
  opts: { requestedFeedEmail?: string | null; marketingOptIn?: boolean } = {},
): Promise<{ id: string }> {
  const { html, text } = await renderBoth(
    FeedConfirmEmail({
      name: row.name,
      confirmUrl: feedConfirmPageUrl(token),
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
      requestedFeedEmail: opts.requestedFeedEmail ?? null,
      marketingOptIn: opts.marketingOptIn === true,
    }),
  );
  const sent = await sendResendEmail(resendClient(), {
    from: fromAddress(),
    to: row.email,
    replyTo: SUPPORT_EMAIL,
    subject: FEED_CONFIRM_SUBJECT,
    html,
    text,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_confirm" }],
  });
  return { id: sent.id };
}

/** Double opt-in for a feed delivery address, sent after the contact who named it has confirmed. */
export async function sendFeedDeliveryConfirmation(
  row: FeedConfirmRow,
  token: string,
  requestedBy: { email: string; name: string | null },
): Promise<{ id: string }> {
  const label = requestedBy.name ? `${requestedBy.name} (${requestedBy.email})` : requestedBy.email;
  const { html, text } = await renderBoth(
    FeedDeliveryConfirmEmail({
      requestedBy: label,
      confirmUrl: feedConfirmPageUrl(token),
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
    }),
  );
  const sent = await sendResendEmail(resendClient(), {
    from: fromAddress(),
    to: row.email,
    replyTo: SUPPORT_EMAIL,
    subject: FEED_DELIVERY_CONFIRM_SUBJECT,
    html,
    text,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_delivery_confirm" }],
  });
  return { id: sent.id };
}

export async function sendFeedEarlyAccessEmail(row: FeedWaitlistRow): Promise<{ id: string } | null> {
  if (!feedEmailRecipient(row)) return null;
  const { html, text } = await renderBoth(
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
    text,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_early_access" }],
  });
  return { id: sent.id };
}

export type FeedLaunchNoticeInput = Omit<FeedLaunchNoticeEmailProps, "name" | "unsubscribeUrl" | "logoSrc">;

export async function sendFeedLaunchNotice(
  row: FeedWaitlistRow,
  input: FeedLaunchNoticeInput,
): Promise<{ id: string } | null> {
  if (!feedEmailRecipient(row)) return null;
  const { html, text } = await renderBoth(
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
    text,
    headers: feedUnsubscribeHeaders(row.unsubscribe_token),
    tags: [{ name: "category", value: "feed_launch_notice" }],
  });
  return { id: sent.id };
}

/** A row that may receive the one-time invitation: not unsubscribed, has a token. */
export interface FeedInviteRow {
  /** Row id; keys the provider idempotency key so a retry cannot deliver a second invitation. */
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
}

export interface FeedInviteInput {
  inviterName: string;
  inviterRole?: string | null;
  note?: string | null;
}

export async function sendFeedInvite(
  row: FeedInviteRow,
  input: FeedInviteInput,
): Promise<{ id: string } | null> {
  if (row.unsubscribed_at || !row.unsubscribe_token) return null;
  const { html, text } = await renderBoth(
    FeedInviteEmail({
      name: row.name,
      inviterName: input.inviterName,
      inviterRole: input.inviterRole ?? undefined,
      note: input.note ?? null,
      joinUrl: `${FEED_PAGE_URL}?utm_source=invite`,
      feedPageUrl: FEED_PAGE_URL,
      unsubscribeUrl: feedUnsubscribePageUrl(row.unsubscribe_token),
    }),
  );
  const sent = await sendResendEmail(
    resendClient(),
    {
      from: fromAddress(),
      to: row.email,
      replyTo: SUPPORT_EMAIL,
      subject: feedInviteSubject(input.inviterName),
      html,
      text,
      headers: feedUnsubscribeHeaders(row.unsubscribe_token),
      tags: [{ name: "category", value: "feed_invite" }],
    },
    { idempotencyKey: `feed-invite/${row.id}` },
  );
  return { id: sent.id };
}
