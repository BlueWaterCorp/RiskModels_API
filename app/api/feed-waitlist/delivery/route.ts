/**
 * Event Ledger: "Send this to your team inbox instead" (edition footer)
 *
 * POST /api/feed-waitlist/delivery   { token, feed_email, stop_contact? }
 *
 * `token` is the recipient's unsubscribe token, carried in the footer link of
 * their own copy of an edition. A forwarded copy carries the same link, so this
 * route changes NOTHING by itself: it emails the CONTACT's own address a
 * confirmation (emails/feed-delivery-change.tsx). Only a click in that email
 * links the inbox (POST /api/feed-waitlist/delivery/confirm), and the inbox
 * then has to confirm for itself through the existing double opt-in.
 *
 * feed_waitlist_claim_delivery_change() (migration 20261113120000) is one
 * atomic UPDATE: it matches only a confirmed, subscribed contact row, never
 * the contact's own address as the inbox, and applies the signup throttle.
 * The reply is the same whether or not anything was sent, so the route cannot
 * be used to test tokens or list state; the email is queued with after().
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { sendFeedDeliveryChangeConfirmation } from "@/lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
  CONFIRM_TOKEN_TTL_MS,
  newConfirmToken,
} from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 3600;

const DELIVERY_REQUEST_MESSAGE =
  "Check the inbox this edition was sent to. We emailed it a link to confirm the team inbox; nothing changes until that link is used.";

interface Claimed {
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
  delivery_change_email: string;
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-waitlist-delivery", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const token = typeof body.token === "string" ? body.token.trim().toLowerCase() : "";
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Invalid link", message: "Open this page from the link in an edition." }, { status: 400, headers: NO_STORE });
  }
  const inbox = typeof body.feed_email === "string" ? body.feed_email.trim().toLowerCase() : "";
  if (!inbox || inbox.length > 254 || !EMAIL_RE.test(inbox)) {
    return NextResponse.json(
      { error: "Invalid feed_email", message: "Enter a valid team inbox address." },
      { status: 400, headers: NO_STORE },
    );
  }
  const stopContact = body.stop_contact === true;

  let claimed: Claimed | null = null;
  const fresh = newConfirmToken();
  try {
    const { data, error } = await createAdminClient().rpc("feed_waitlist_claim_delivery_change", {
      p_unsubscribe_token: token,
      p_feed_email: inbox,
      p_stop_contact: stopContact,
      p_token_hash: fresh.hash,
      p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
      p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
      p_max_sends: CONFIRM_MAX_SENDS,
      p_window_seconds: CONFIRM_WINDOW_SEC,
    });
    if (error) {
      console.error("[feed-waitlist/delivery] claim_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Could not save", message: "Could not save. Please try again shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    claimed = Array.isArray(data) && data.length > 0 ? (data[0] as Claimed) : null;
  } catch (err) {
    console.error("[feed-waitlist/delivery] unexpected_error", safeErrorCode(err));
    return NextResponse.json(
      { error: "Could not save", message: "Could not save. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (claimed) {
    const row = claimed;
    after(async () => {
      try {
        // The inbox named in the email is the one STORED by the claim, not this request's text.
        await sendFeedDeliveryChangeConfirmation(row, fresh.token, {
          inbox: row.delivery_change_email,
          stopContact,
        });
      } catch (err) {
        console.error("[feed-waitlist/delivery] email_failed", safeErrorCode(err));
      }
    });
  }

  return NextResponse.json({ ok: true, message: DELIVERY_REQUEST_MESSAGE }, { headers: NO_STORE });
}
