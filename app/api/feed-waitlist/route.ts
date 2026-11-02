/**
 * Security master feed early-access list
 *
 * POST /api/feed-waitlist
 *   { email, name?, company?, role?, intended_use?, consent_feed_emails?, website? }
 *
 * Public, unauthenticated signup behind the /security-master-feed landing page.
 * Writes one row per email to public.feed_waitlist with the service-role
 * client (migrations: BWMACRO/supabase/migrations/20261102120000_feed_waitlist.sql
 * and 20261102190000_feed_waitlist_double_optin.sql).
 *
 * Double opt-in. This route NEVER records consent. The form's "email me" box
 * only asks for a confirmation email, sent to the address given; consent is
 * recorded when the owner of that address confirms
 * (POST /api/feed-waitlist/confirm). So nobody can opt a third party in.
 *
 * - Abuse controls: per-IP fixed-window rate limit (lib/oauth/rate-limit), a
 *   hidden `website` honeypot field, and a per-address cap on confirmation
 *   emails enforced atomically in the database
 *   (feed_waitlist_claim_confirmation: at most CONFIRM_MAX_SENDS in total, at
 *   least CONFIRM_MIN_INTERVAL_SEC apart, never for a consented or unsubscribed
 *   row). A filled honeypot gets the normal reply and writes nothing.
 * - Idempotent: emails are stored lowercased under a unique constraint; the
 *   first row is never overwritten.
 * - Same reply and same work on every success path. The reply depends only on
 *   what the visitor submitted, never on whether the address was already
 *   listed, consented or unsubscribed. The confirmation email is queued with
 *   after() and not awaited, so provider latency cannot reveal list state.
 * - If the visitor has a RiskModels session, its user id is attached to a new
 *   row.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { FEED_INTENDED_USE_VALUES, type FeedIntendedUse } from "@/lib/feed-waitlist";
import { sendFeedConfirmation, type FeedConfirmRow } from "@/lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_TOKEN_TTL_MS,
  newConfirmToken,
} from "@/lib/feed-token";
import { safeErrorCode } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
const MAX_TEXT = 200;
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 3600;
// Deliberately simple: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NO_STORE = { "Cache-Control": "no-store" };
const CONFIRM_MESSAGE =
  "Check your email. We sent a link to confirm your address; you join the early-access list when you click it.";
const INTEREST_MESSAGE =
  "Thank you. We have noted your interest. We will not email you about the feed unless you tick the email box.";

function optionalText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, MAX_TEXT) : null;
}

async function sessionUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-waitlist", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
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

  const wantsEmails = body.consent_feed_emails === true;
  const reply = { ok: true, message: wantsEmails ? CONFIRM_MESSAGE : INTEREST_MESSAGE };

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json(reply, { headers: NO_STORE });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Invalid email", message: "Enter a valid email address." },
      { status: 400, headers: NO_STORE },
    );
  }

  let intendedUse: FeedIntendedUse | null = null;
  if (body.intended_use != null && body.intended_use !== "") {
    if (typeof body.intended_use !== "string" || !FEED_INTENDED_USE_VALUES.includes(body.intended_use)) {
      return NextResponse.json(
        {
          error: "Invalid intended_use",
          message: `intended_use must be one of: ${FEED_INTENDED_USE_VALUES.join(", ")}.`,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    intendedUse = body.intended_use as FeedIntendedUse;
  }

  const userId = await sessionUserId();
  const unavailable = () =>
    NextResponse.json(
      { error: "Signup unavailable", message: "Could not record your signup. Please retry shortly." },
      { status: 503, headers: NO_STORE },
    );

  let claimed: FeedConfirmRow | null = null;
  let token = "";
  try {
    const admin = createAdminClient();

    // A new row never carries consent. An existing row is left exactly as it was.
    const { error } = await admin.from("feed_waitlist").upsert(
      {
        email,
        name: optionalText(body.name),
        company: optionalText(body.company),
        role: optionalText(body.role),
        intended_use: intendedUse,
        consent_feed_emails: false,
        consented_at: null,
        user_id: userId,
        source: "security-master-feed",
        metadata: {
          user_agent: req.headers.get("user-agent"),
          referer: req.headers.get("referer"),
        },
      },
      { onConflict: "email", ignoreDuplicates: true },
    );
    if (error) {
      console.error("[feed-waitlist] insert_failed", safeErrorCode(error));
      return unavailable();
    }

    if (wantsEmails) {
      // One atomic UPDATE decides whether a confirmation email may go out. It matches nothing for a
      // consented or unsubscribed row, a row mailed in the last interval, or one at the send cap.
      const fresh = newConfirmToken();
      const { data, error: claimError } = await admin.rpc("feed_waitlist_claim_confirmation", {
        p_email: email,
        p_token_hash: fresh.hash,
        p_expires_at: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString(),
        p_min_interval_seconds: CONFIRM_MIN_INTERVAL_SEC,
        p_max_sends: CONFIRM_MAX_SENDS,
      });
      if (claimError) {
        console.error("[feed-waitlist] claim_failed", safeErrorCode(claimError));
        return unavailable();
      }
      if (Array.isArray(data) && data.length > 0) {
        claimed = data[0] as FeedConfirmRow;
        token = fresh.token;
      }
    }
  } catch (err) {
    console.error("[feed-waitlist] unexpected_error", safeErrorCode(err));
    return unavailable();
  }

  if (claimed) {
    const row = claimed;
    const confirmToken = token;
    // Queued, not awaited: a provider round trip here would make a first signup slower than a
    // repeat one, and the difference would reveal who is already listed.
    after(async () => {
      try {
        await sendFeedConfirmation(row, confirmToken);
      } catch (err) {
        console.error("[feed-waitlist] confirmation_email_failed", safeErrorCode(err));
      }
    });
  }

  return NextResponse.json(reply, { headers: NO_STORE });
}
