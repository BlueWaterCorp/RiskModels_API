/**
 * Security master feed: ask for a private feed address
 *
 * POST /api/feed-waitlist/access/request   { email }
 *
 * Sends the address a single-use link that creates a private feed credential,
 * but only when the address is an approved, confirmed, not-unsubscribed contact.
 * One atomic UPDATE in the database decides that and caps the sends
 * (feed_access_claim_link). The reply is the same sentence for every address,
 * and the email is queued after the response, so neither the reply nor its
 * timing says whether the address is listed, pending, approved or refused.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { sendFeedAccessLink } from "@/lib/feed-email";
import {
  ACCESS_LINK_MAX_SENDS,
  ACCESS_LINK_MIN_INTERVAL_SEC,
  ACCESS_LINK_TTL_MS,
  ACCESS_LINK_WINDOW_SEC,
} from "@/lib/feed-access";
import { newConfirmToken } from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 3600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPLY = {
  ok: true,
  message:
    "If that address is an approved subscriber, we have sent it a link to create a private feed address. The link works once, for one hour.",
};

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-access-request", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", message: "Please try again later." },
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

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json(REPLY, { headers: NO_STORE });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Invalid email", message: "Enter a valid email address." },
      { status: 400, headers: NO_STORE },
    );
  }

  const fresh = newConfirmToken();
  let claimed: { email: string; name: string | null; unsubscribe_token: string } | null = null;
  try {
    const { data, error } = await createAdminClient().rpc("feed_access_claim_link", {
      p_email: email,
      p_token_hash: fresh.hash,
      p_expires_at: new Date(Date.now() + ACCESS_LINK_TTL_MS).toISOString(),
      p_min_interval_seconds: ACCESS_LINK_MIN_INTERVAL_SEC,
      p_max_sends: ACCESS_LINK_MAX_SENDS,
      p_window_seconds: ACCESS_LINK_WINDOW_SEC,
    });
    if (error) {
      console.error("[feed-waitlist/access/request] claim_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Unavailable", message: "Could not process the request. Please retry shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    if (Array.isArray(data) && data.length > 0) claimed = data[0] as typeof claimed;
  } catch (err) {
    console.error("[feed-waitlist/access/request] unexpected_error", safeErrorCode(err));
    return NextResponse.json(
      { error: "Unavailable", message: "Could not process the request. Please retry shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (claimed) {
    const row = claimed;
    after(async () => {
      try {
        await sendFeedAccessLink(row, fresh.token);
      } catch (err) {
        console.error("[feed-waitlist/access/request] access_email_failed", safeErrorCode(err));
      }
    });
  }

  return NextResponse.json(REPLY, { headers: NO_STORE });
}
