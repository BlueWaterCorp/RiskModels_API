/**
 * Operator actions on the feed list, for BWMACRO /admin/feed-list (which runs this
 * with execFile) and for the terminal. One place for the rules; the admin page
 * holds none of them.
 *
 *   npx tsx scripts/feed-admin.ts invite --email <a> --invited-by "<Name>" [--name "<n>"] [--note "<text>"]
 *   npx tsx scripts/feed-admin.ts resend-confirm --email <a>
 *   npx tsx scripts/feed-admin.ts unsubscribe --email <a>
 *   npx tsx scripts/feed-admin.ts add-delivery --contact <a> --inbox <b> [--stop-contact]
 *   npx tsx scripts/feed-admin.ts remove-delivery --contact <a> --inbox <b>
 *
 * stdout is exactly one JSON line: {"ok":true,"outcome":"..."} (exit 0) or
 * {"ok":false,"error":"<fixed event>"} (exit 1, 2 for usage). Upstream messages,
 * addresses and tokens are never printed.
 *
 * - invite: the existing personal invitation (lib/feed-invite.ts). Never records consent.
 * - resend-confirm: a new confirmation email for a pending address, through the same atomic,
 *   throttled claim as a signup. A contact row's confirmation names its stored delivery address.
 * - unsubscribe: sets unsubscribed_at (first use only), as the unsubscribe link does.
 * - add-delivery: links an inbox to a confirmed contact (feed_waitlist_admin_link_delivery), then
 *   asks the inbox to confirm for itself (lib/feed-delivery.ts). Nothing is delivered there until it does.
 * - remove-delivery: removes the link. The inbox row stays (its consent history is kept) and stops
 *   receiving because no live contact links to it any more.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and, for the
 * sending actions, RESEND_API_KEY.
 */

import { createAdminClient } from "../lib/supabase/admin";
import { FeedInviteError, inviteToFeedWaitlist } from "../lib/feed-invite";
import { askDeliveryAddressToConfirm, FeedDeliveryError } from "../lib/feed-delivery";
import { sendFeedConfirmation, type FeedConfirmRow } from "../lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
  CONFIRM_TOKEN_TTL_MS,
  newConfirmToken,
} from "../lib/feed-token";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

class AdminError extends Error {
  constructor(readonly event: string) {
    super(event);
  }
}

function email(name: string): string {
  const v = (arg(name) ?? "").trim().toLowerCase();
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) throw new AdminError(`invalid_${name.replace(/-/g, "_")}`);
  return v;
}

async function resendConfirm(): Promise<string> {
  const admin = createAdminClient();
  const fresh = newConfirmToken();
  const { data, error } = await admin.rpc("feed_waitlist_claim_confirmation", {
    p_email: email("email"),
    p_token_hash: fresh.hash,
    p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
    p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
    p_max_sends: CONFIRM_MAX_SENDS,
    p_window_seconds: CONFIRM_WINDOW_SEC,
  });
  if (error) throw new AdminError("claim_failed");
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as FeedConfirmRow) : null;
  // Not pending (confirmed, unsubscribed or unknown), or mailed too recently / at the cap.
  if (!row) return "not_sent_not_pending_or_throttled";
  try {
    await sendFeedConfirmation(row, fresh.token, { requestedFeedEmail: row.requested_feed_email ?? null });
  } catch {
    throw new AdminError("send_failed");
  }
  return "confirmation_sent";
}

async function unsubscribe(): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("feed_waitlist")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("email", email("email"))
    .is("unsubscribed_at", null)
    .select("id");
  if (error) throw new AdminError("update_failed");
  return Array.isArray(data) && data.length ? "unsubscribed" : "already_unsubscribed_or_not_found";
}

async function addDelivery(): Promise<string> {
  const admin = createAdminClient();
  const contact = email("contact");
  const inbox = email("inbox");
  const { data, error } = await admin.rpc("feed_waitlist_admin_link_delivery", {
    p_contact_email: contact,
    p_feed_email: inbox,
    p_stop_contact: process.argv.includes("--stop-contact"),
  });
  if (error) throw new AdminError("link_failed");
  const reason = (Array.isArray(data) && data[0] ? (data[0] as { reason: string }).reason : null) ?? "link_failed";
  if (reason !== "linked") return reason;
  const { data: c } = await admin.from("feed_waitlist").select("name").eq("email", contact).maybeSingle();
  try {
    const sent = await askDeliveryAddressToConfirm(admin, inbox, { email: contact, name: (c as { name?: string | null } | null)?.name ?? null });
    return sent === "confirmation_sent" ? "linked_confirmation_sent" : "linked_inbox_already_confirmed_or_throttled";
  } catch (err) {
    throw new AdminError(err instanceof FeedDeliveryError ? err.event : "delivery_failed");
  }
}

async function removeDelivery(): Promise<string> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("feed_waitlist")
    .select("id, email, purpose")
    .in("email", [email("contact"), email("inbox")]);
  if (error) throw new AdminError("read_failed");
  const list = (rows ?? []) as { id: string; email: string; purpose: string }[];
  const c = list.find((r) => r.email === email("contact") && r.purpose === "contact");
  const f = list.find((r) => r.email === email("inbox") && r.purpose === "feed");
  if (!c || !f) return "not_linked";
  const { data, error: delError } = await admin
    .from("feed_waitlist_delivery")
    .delete()
    .eq("contact_id", c.id)
    .eq("feed_id", f.id)
    .select("contact_id");
  if (delError) throw new AdminError("delete_failed");
  return Array.isArray(data) && data.length ? "removed" : "not_linked";
}

async function invite(): Promise<string> {
  const inviterName = (arg("invited-by") ?? "").trim();
  if (!inviterName) throw new AdminError("invalid_invited_by");
  try {
    return await inviteToFeedWaitlist({
      email: email("email"),
      name: arg("name") ?? null,
      inviterName,
      inviterRole: arg("role") ?? "founder of RiskModels",
      note: arg("note") ?? null,
    });
  } catch (err) {
    throw new AdminError(err instanceof FeedInviteError ? err.event : "invite_failed");
  }
}

const COMMANDS: Record<string, () => Promise<string>> = {
  invite,
  "resend-confirm": resendConfirm,
  unsubscribe,
  "add-delivery": addDelivery,
  "remove-delivery": removeDelivery,
};

async function main() {
  const command = process.argv[2] ?? "";
  const run = COMMANDS[command];
  if (!run) {
    console.log(JSON.stringify({ ok: false, error: "unknown_command" }));
    process.exit(2);
  }
  const outcome = await run();
  console.log(JSON.stringify({ ok: true, outcome }));
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err instanceof AdminError ? err.event : "unexpected_error" }));
  process.exit(1);
});
