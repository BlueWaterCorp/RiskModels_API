/**
 * Security master feed: confirm an address (double opt-in)
 *
 * POST /api/feed-waitlist/confirm   { token }  or  ?token=
 *
 * The token is the single-use value from the confirmation email
 * (emails/feed-confirm.tsx). Only its sha256 is stored, so the lookup hashes the
 * submitted token. One conditional UPDATE records the consent (consent_feed_emails,
 * consented_at) and clears the token. It matches nothing for an unknown, used or
 * expired token, or for an unsubscribed row, so confirming twice is harmless and
 * an unsubscribed address cannot be re-subscribed by an old link.
 *
 * The page /security-master-feed/confirm asks for a click before posting here, so
 * a mail scanner that fetches the link cannot confirm anyone. GET is not
 * supported. On success the welcome email (emails/feed-early-access.tsx) is queued
 * with after().
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { sendFeedEarlyAccessEmail, type FeedWaitlistRow } from "@/lib/feed-email";
import { CONFIRM_TOKEN_RE, hashConfirmToken } from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";

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

  let confirmed: FeedWaitlistRow | null = null;
  try {
    const now = new Date().toISOString();
    const { data, error } = await createAdminClient()
      .from("feed_waitlist")
      .update({
        consent_feed_emails: true,
        consented_at: now,
        confirm_token_hash: null,
        confirm_expires_at: null,
      })
      .eq("confirm_token_hash", hashConfirmToken(token))
      .eq("consent_feed_emails", false)
      .is("unsubscribed_at", null)
      .gt("confirm_expires_at", now)
      .select("email, name, consent_feed_emails, unsubscribe_token, unsubscribed_at");
    if (error) {
      console.error("[feed-waitlist/confirm] update_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Could not save", message: "Could not save. Please try again shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    confirmed = Array.isArray(data) && data.length > 0 ? (data[0] as FeedWaitlistRow) : null;
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
    try {
      await sendFeedEarlyAccessEmail(row);
    } catch (err) {
      console.error("[feed-waitlist/confirm] welcome_email_failed", safeErrorCode(err));
    }
  });

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
