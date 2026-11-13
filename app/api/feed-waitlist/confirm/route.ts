/**
 * Security master feed: confirm an address (double opt-in)
 *
 * POST /api/feed-waitlist/confirm   { token }  or  ?token=
 *
 * The token is the single-use value from a confirmation email
 * (emails/feed-confirm.tsx for a contact, emails/feed-delivery-confirm.tsx for a
 * feed delivery address). Only its sha256 is stored, so the lookup hashes the
 * submitted token. The database function feed_waitlist_confirm() records the
 * consent and clears the token in one conditional UPDATE. It matches nothing for
 * an unknown, used or expired token, or for an unsubscribed row, so confirming
 * twice is harmless and an unsubscribed address cannot be re-subscribed by an old
 * link.
 *
 * When the confirmed row is a contact that asked for a separate delivery address,
 * the same transaction creates that address's row and links it. After the response,
 * a confirmation email is queued to that address (it must confirm for itself), and
 * the contact gets the welcome email. A confirmed delivery address gets no welcome:
 * it receives editions only.
 *
 * The page /security-master-feed/confirm asks for a click before posting here, so
 * a mail scanner that fetches the link cannot confirm anyone. GET is not
 * supported.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import {
  sendFeedDeliveryConfirmation,
  sendFeedEarlyAccessEmail,
  type FeedConfirmRow,
} from "@/lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
  CONFIRM_TOKEN_RE,
  CONFIRM_TOKEN_TTL_MS,
  hashConfirmToken,
  newConfirmToken,
} from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";
import { DELIVERY_CLAIM_VALUES } from "@/lib/feed-delivery";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 3600;
const INVALID = {
  error: "Invalid or expired link",
  message: "This confirmation link is invalid or has expired. Join again from the early-access page.",
};

async function readToken(req: NextRequest): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery) return fromQuery;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body: unknown = await req.json();
      if (body && typeof body === "object" && "token" in body) {
        const t = (body as { token: unknown }).token;
        return typeof t === "string" ? t : null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-waitlist-confirm", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const token = (await readToken(req))?.trim() ?? "";
  if (!CONFIRM_TOKEN_RE.test(token)) {
    return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });
  }

  interface Confirmed {
    id: string;
    email: string;
    name: string | null;
    unsubscribe_token: string;
    purpose: "contact" | "feed";
    feed_email: string | null;
  }

  let confirmed: Confirmed | null = null;
  const admin = createAdminClient();
  try {
    // One transaction in the database: records consent, clears the token and, for a contact that asked
    // for a separate delivery address, creates and links that address.
    const { data, error } = await admin.rpc("feed_waitlist_confirm", { p_token_hash: hashConfirmToken(token) });
    if (error) {
      console.error("[feed-waitlist/confirm] confirm_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Could not save", message: "Could not save. Please try again shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    confirmed = Array.isArray(data) && data.length > 0 ? (data[0] as Confirmed) : null;
  } catch (err) {
    console.error("[feed-waitlist/confirm] unexpected_error", safeErrorCode(err));
    return NextResponse.json(
      { error: "Could not save", message: "Could not save. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!confirmed) return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });

  const row = confirmed;
  after(async () => {
    // The contact gets the welcome. A delivery address receives editions only, so it gets none.
    if (row.purpose === "contact") {
      try {
        await sendFeedEarlyAccessEmail({
          email: row.email,
          name: row.name,
          consent_feed_emails: true,
          unsubscribe_token: row.unsubscribe_token,
          unsubscribed_at: null,
          purpose: "contact",
        });
      } catch (err) {
        console.error("[feed-waitlist/confirm] welcome_email_failed", safeErrorCode(err));
      }
    }

    // The contact authorised a delivery address by confirming. That address must now confirm for itself:
    // the same atomic, throttled claim as a signup, so it is never mailed twice in a row, more than the cap,
    // or when it has already consented or unsubscribed.
    if (row.feed_email) {
      try {
        const fresh = newConfirmToken();
        const { data, error } = await admin.rpc("feed_waitlist_claim_confirmation", {
          p_email: row.feed_email,
          p_token_hash: fresh.hash,
          p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
          p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
          p_max_sends: CONFIRM_MAX_SENDS,
          p_window_seconds: CONFIRM_WINDOW_SEC,
          // A delivery address records no marketing, terms or referral; anything planted is reset.
          ...DELIVERY_CLAIM_VALUES,
        });
        if (error) {
          console.error("[feed-waitlist/confirm] delivery_claim_failed", safeErrorCode(error));
          return;
        }
        const target = Array.isArray(data) && data.length > 0 ? (data[0] as FeedConfirmRow) : null;
        if (target) await sendFeedDeliveryConfirmation(target, fresh.token, { email: row.email, name: row.name });
      } catch (err) {
        console.error("[feed-waitlist/confirm] delivery_confirmation_failed", safeErrorCode(err));
      }
    }
  });

  return NextResponse.json({ ok: true, purpose: row.purpose }, { headers: NO_STORE });
}
