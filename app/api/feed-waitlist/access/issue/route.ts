/**
 * Security master feed: create a private feed address
 *
 * POST /api/feed-waitlist/access/issue   { token }
 *
 * The token is the single-use value from the access email. The database function
 * feed_access_issue() consumes it and stores the hash of a new credential in one
 * transaction, revoking any earlier credential of the same contact. It matches
 * nothing for an unknown, used or expired token, or when the contact is no longer
 * approved, confirmed and subscribed.
 *
 * The credential is returned once, in this response, and is not stored or logged
 * here. POST only, and the page asks for a click first, so a mail scanner that
 * fetches the emailed link cannot consume it.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { newFeedKey } from "@/lib/feed-access";
import { FEED_PAGE_URL } from "@/lib/feed-descriptor";
import { CONFIRM_TOKEN_RE, hashConfirmToken } from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const RATE_LIMIT = 20;
const RATE_WINDOW_SEC = 3600;
const INVALID = {
  error: "Invalid or expired link",
  message: "This link is invalid, already used or expired. Request a new one from the access page.",
};

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-access-issue", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  let token = "";
  try {
    const body: unknown = await req.json();
    const t = body && typeof body === "object" ? (body as { token?: unknown }).token : null;
    token = typeof t === "string" ? t.trim() : "";
  } catch {
    token = "";
  }
  if (!CONFIRM_TOKEN_RE.test(token)) return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });

  const fresh = newFeedKey();
  try {
    const { data, error } = await createAdminClient().rpc("feed_access_issue", {
      p_link_token_hash: hashConfirmToken(token),
      p_new_token_hash: fresh.hash,
    });
    if (error) {
      console.error("[feed-waitlist/access/issue] issue_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Unavailable", message: "Could not create the feed address. Please try again shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });
    }
  } catch (err) {
    console.error("[feed-waitlist/access/issue] unexpected_error", safeErrorCode(err));
    return NextResponse.json(
      { error: "Unavailable", message: "Could not create the feed address. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  const key = encodeURIComponent(fresh.key);
  return NextResponse.json(
    {
      ok: true,
      key: fresh.key,
      rss_url: `${FEED_PAGE_URL}/private/feed.xml?key=${key}`,
      json_url: `${FEED_PAGE_URL}/private/latest.json?key=${key}`,
    },
    { headers: NO_STORE },
  );
}
