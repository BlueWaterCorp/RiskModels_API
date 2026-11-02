/**
 * Security master feed early-access list
 *
 * POST /api/feed-waitlist
 *   { email, name?, company?, role?, intended_use?, consent_feed_emails?, website? }
 *
 * Public, unauthenticated signup behind the /security-master-feed landing page.
 * Writes one row per email to public.feed_waitlist with the service-role
 * client (migration: BWMACRO/supabase/migrations/20261102120000_feed_waitlist.sql).
 *
 * - Abuse controls: per-IP fixed-window rate limit (lib/oauth/rate-limit, the
 *   limiter used by the unauthenticated OAuth endpoints) and a hidden
 *   `website` honeypot field. A filled honeypot gets the normal success reply
 *   and writes nothing.
 * - Idempotent: emails are stored lowercased under a unique constraint; a
 *   repeat signup returns the same success reply and does not overwrite the
 *   first row. The reply never says whether the email was already listed.
 * - If the visitor has a RiskModels session, its user id is attached.
 * - A NEW row with consent_feed_emails = true gets one early-access
 *   confirmation email (lib/feed-email.ts). A repeat signup inserts nothing and
 *   sends nothing. A failed send is logged and never fails the signup.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { FEED_INTENDED_USE_VALUES, type FeedIntendedUse } from "@/lib/feed-waitlist";
import { sendFeedEarlyAccessEmail, type FeedWaitlistRow } from "@/lib/feed-email";

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
const MAX_TEXT = 200;
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 3600;
// Deliberately simple: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NO_STORE = { "Cache-Control": "no-store" };
const SUCCESS_MESSAGE =
  "You are on the early-access list. We will email you before the first edition.";

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

  // Honeypot: real visitors never see or fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE }, { headers: NO_STORE });
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

  const consent = body.consent_feed_emails === true;
  const userId = await sessionUserId();

  let inserted: FeedWaitlistRow | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("feed_waitlist").upsert(
      {
        email,
        name: optionalText(body.name),
        company: optionalText(body.company),
        role: optionalText(body.role),
        intended_use: intendedUse,
        consent_feed_emails: consent,
        consented_at: consent ? new Date().toISOString() : null,
        user_id: userId,
        source: "security-master-feed",
        metadata: {
          user_agent: req.headers.get("user-agent"),
          referer: req.headers.get("referer"),
        },
      },
      { onConflict: "email", ignoreDuplicates: true },
    )
      // With ignoreDuplicates, only a newly inserted row comes back; a repeat signup returns none.
      .select("email, name, consent_feed_emails, unsubscribe_token, unsubscribed_at");

    if (error) {
      console.error("[feed-waitlist] insert failed:", error.message);
      return NextResponse.json(
        { error: "Signup unavailable", message: "Could not record your signup. Please retry shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    inserted = Array.isArray(data) && data.length > 0 ? (data[0] as FeedWaitlistRow) : null;
  } catch (err) {
    console.error("[feed-waitlist] unexpected error:", err);
    return NextResponse.json(
      { error: "Signup unavailable", message: "Could not record your signup. Please retry shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (inserted && inserted.consent_feed_emails) {
    try {
      await sendFeedEarlyAccessEmail(inserted);
    } catch (err) {
      console.error("[feed-waitlist] confirmation email failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, message: SUCCESS_MESSAGE }, { headers: NO_STORE });
}
