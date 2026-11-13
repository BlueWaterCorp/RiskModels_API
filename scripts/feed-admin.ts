/**
 * Operator actions on the feed list, for BWMACRO /admin/feed-list (which runs this
 * with execFile) and for the terminal. One place for the rules; the admin page
 * holds none of them.
 *
 *   npx tsx scripts/feed-admin.ts invite --email <a> --invited-by "<Name>" [--name "<n>"] [--note "<text>"]
 *   npx tsx scripts/feed-admin.ts resend-confirm --email <a>
 *   npx tsx scripts/feed-admin.ts unsubscribe --email <a>
 *   npx tsx scripts/feed-admin.ts add-delivery --contact <a> --inbox <b>
 *   npx tsx scripts/feed-admin.ts remove-delivery --contact <a> --inbox <b>
 *
 * Arguments are parsed strictly (node:util parseArgs): an unknown option is an error.
 * stdout is exactly one JSON line: {"ok":true,"outcome":"..."} (exit 0) or
 * {"ok":false,"error":"<fixed event>"} (exit 1, 2 for usage). Upstream messages,
 * addresses and tokens are never printed.
 *
 * - invite: the existing personal invitation (lib/feed-invite.ts). Never records consent.
 * - resend-confirm: a new confirmation email for a pending address, through the same atomic,
 *   throttled claim as a signup. It is not a submission, so it applies the terms, marketing and
 *   referral values of the signup that is already pending, and changes none of them.
 * - unsubscribe: sets unsubscribed_at (first use only) and clears the marketing opt-in.
 * - add-delivery: the same request as the edition footer's "Send this to your team inbox instead":
 *   the CONTACT's own address gets the confirmation email, and only their click links the inbox,
 *   which then confirms for itself. The operator can never cut off a contact's own delivery; only
 *   the contact can choose that, from the footer page.
 * - remove-delivery: removes the link. The inbox row stays (its consent history is kept) and stops
 *   receiving because no live contact links to it any more.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and, for the
 * sending actions, RESEND_API_KEY.
 */

import { parseArgs } from "node:util";
import { createAdminClient } from "../lib/supabase/admin";
import { FeedInviteError, inviteToFeedWaitlist } from "../lib/feed-invite";
import {
  sendFeedConfirmation,
  sendFeedDeliveryChangeConfirmation,
  type FeedConfirmRow,
} from "../lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
  CONFIRM_TOKEN_TTL_MS,
  newConfirmToken,
} from "../lib/feed-token";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AdminError extends Error {
  constructor(readonly event: string) {
    super(event);
  }
}

type Values = Record<string, string | undefined>;

const OPTIONS = {
  invite: ["email", "invited-by", "name", "note", "role"],
  "resend-confirm": ["email"],
  unsubscribe: ["email"],
  "add-delivery": ["contact", "inbox"],
  "remove-delivery": ["contact", "inbox"],
} as const;

function email(v: Values, name: string): string {
  const s = (v[name] ?? "").trim().toLowerCase();
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) throw new AdminError(`invalid_${name.replace(/-/g, "_")}`);
  return s;
}

async function resendConfirm(v: Values): Promise<string> {
  const admin = createAdminClient();
  const fresh = newConfirmToken();
  const { data, error } = await admin.rpc("feed_waitlist_claim_confirmation", {
    p_email: email(v, "email"),
    p_token_hash: fresh.hash,
    p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
    p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
    p_max_sends: CONFIRM_MAX_SENDS,
    p_window_seconds: CONFIRM_WINDOW_SEC,
    p_from_submission: false,
  });
  if (error) throw new AdminError("claim_failed");
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as FeedConfirmRow) : null;
  // Not pending (confirmed, unsubscribed or unknown), or mailed too recently / at the cap.
  if (!row) return "not_sent_not_pending_or_throttled";
  try {
    await sendFeedConfirmation(row, fresh.token, {
      requestedFeedEmail: row.requested_feed_email ?? null,
      marketingOptIn: row.marketing_opt_in === true,
    });
  } catch {
    throw new AdminError("send_failed");
  }
  return "confirmation_sent";
}

async function unsubscribe(v: Values): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("feed_waitlist")
    .update({ unsubscribed_at: new Date().toISOString(), marketing_opt_in: false, marketing_opt_in_at: null })
    .eq("email", email(v, "email"))
    .is("unsubscribed_at", null)
    .select("id");
  if (error) throw new AdminError("update_failed");
  return Array.isArray(data) && data.length ? "unsubscribed" : "already_unsubscribed_or_not_found";
}

interface DeliveryClaim {
  status: "claimed" | "pending" | "not_sent";
  email: string | null;
  name: string | null;
  unsubscribe_token: string | null;
  delivery_change_email: string | null;
}

async function addDelivery(v: Values): Promise<string> {
  const admin = createAdminClient();
  const contact = email(v, "contact");
  const inbox = email(v, "inbox");
  const { data: c, error: readError } = await admin
    .from("feed_waitlist")
    .select("unsubscribe_token")
    .eq("email", contact)
    .eq("purpose", "contact")
    .maybeSingle();
  if (readError) throw new AdminError("read_failed");
  const token = (c as { unsubscribe_token?: string } | null)?.unsubscribe_token;
  if (!token) return "contact_not_found";
  const fresh = newConfirmToken();
  const { data, error } = await admin.rpc("feed_waitlist_claim_delivery_change", {
    p_unsubscribe_token: token,
    p_feed_email: inbox,
    // Never on the operator's say-so: only the contact can stop their own delivery.
    p_stop_contact: false,
    p_token_hash: fresh.hash,
    p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
    p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
    p_max_sends: CONFIRM_MAX_SENDS,
    p_window_seconds: CONFIRM_WINDOW_SEC,
  });
  if (error) throw new AdminError("claim_failed");
  const claim = Array.isArray(data) && data[0] ? (data[0] as DeliveryClaim) : null;
  if (claim?.status === "pending") return "request_already_pending";
  if (claim?.status !== "claimed" || !claim.email || !claim.unsubscribe_token) {
    return "not_sent_contact_not_confirmed_or_throttled";
  }
  try {
    await sendFeedDeliveryChangeConfirmation(
      { email: claim.email, name: claim.name, unsubscribe_token: claim.unsubscribe_token },
      fresh.token,
      { inbox: claim.delivery_change_email ?? inbox, stopContact: false },
    );
  } catch {
    throw new AdminError("send_failed");
  }
  return "contact_confirmation_sent";
}

async function removeDelivery(v: Values): Promise<string> {
  const admin = createAdminClient();
  const contact = email(v, "contact");
  const inbox = email(v, "inbox");
  const { data: rows, error } = await admin.from("feed_waitlist").select("id, email, purpose").in("email", [contact, inbox]);
  if (error) throw new AdminError("read_failed");
  const list = (rows ?? []) as { id: string; email: string; purpose: string }[];
  const c = list.find((r) => r.email === contact && r.purpose === "contact");
  const f = list.find((r) => r.email === inbox && r.purpose === "feed");
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

async function invite(v: Values): Promise<string> {
  const inviterName = (v["invited-by"] ?? "").trim();
  if (!inviterName) throw new AdminError("invalid_invited_by");
  try {
    return await inviteToFeedWaitlist({
      email: email(v, "email"),
      name: v.name ?? null,
      inviterName,
      inviterRole: v.role ?? "founder of RiskModels",
      note: v.note ?? null,
    });
  } catch (err) {
    throw new AdminError(err instanceof FeedInviteError ? err.event : "invite_failed");
  }
}

const COMMANDS: Record<keyof typeof OPTIONS, (v: Values) => Promise<string>> = {
  invite,
  "resend-confirm": resendConfirm,
  unsubscribe,
  "add-delivery": addDelivery,
  "remove-delivery": removeDelivery,
};

async function main() {
  const command = process.argv[2] ?? "";
  if (!(command in COMMANDS)) {
    console.log(JSON.stringify({ ok: false, error: "unknown_command" }));
    process.exit(2);
  }
  const names = OPTIONS[command as keyof typeof OPTIONS];
  let values: Values;
  try {
    values = parseArgs({
      args: process.argv.slice(3),
      strict: true,
      allowPositionals: false,
      options: Object.fromEntries(names.map((n) => [n, { type: "string" as const }])),
    }).values as Values;
  } catch {
    console.log(JSON.stringify({ ok: false, error: "invalid_arguments" }));
    process.exit(2);
  }
  const outcome = await COMMANDS[command as keyof typeof OPTIONS](values);
  console.log(JSON.stringify({ ok: true, outcome }));
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err instanceof AdminError ? err.event : "unexpected_error" }));
  process.exit(1);
});
