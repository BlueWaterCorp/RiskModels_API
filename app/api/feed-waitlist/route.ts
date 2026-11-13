/**
 * Security master feed early-access list
 *
 * POST /api/feed-waitlist
 *   { email, terms_accepted, feed_email?, name?, company?, role?, intended_use?,
 *     firm_type?, firm_size?, uses?, audience?, heard_about?, marketing_opt_in?,
 *     consent_feed_emails?, ref?, website? }
 *
 * Everything except email and terms_accepted is optional; terms_accepted must be
 * true (the form's required box). Profile answers are written on a NEW row only
 * and activate nothing. Values outside the allowed lists get a 400
 * (lib/feed-waitlist.ts mirrors the CHECK constraints of migration 20261113120000).
 *
 * Terms, the marketing opt-in (a separate, unticked box) and the referral code
 * (`ref`, from a "Forward to a colleague" link) are consent-like: a value a third
 * party typed for someone's address must never take effect. They are never
 * written on insert. They go with the confirmation CLAIM of this submission
 * (p_from_submission), the confirmation email states the marketing choice, and
 * feed_waitlist_confirm applies them only when the owner clicks that email. A
 * signup without the email box sends no confirmation and records none of them.
 * A bad or unknown referral code is ignored, never an error.
 *
 * Two addresses. `email` is the contact: the person, who gets the relationship
 * email. `feed_email` is an optional separate DELIVERY address for the feed itself,
 * such as a team mailbox or an agent inbox. It is stored on a NEW contact row as
 * requested_feed_email and acted on only after the contact confirms their own
 * address (POST /api/feed-waitlist/confirm), whose email names the delivery
 * address, so nobody can point someone else's feed at an address of their own
 * choosing. The delivery address then has to confirm for itself.
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
 *   (feed_waitlist_claim_confirmation: at most CONFIRM_MAX_SENDS per rolling
 *   CONFIRM_WINDOW_SEC, at least CONFIRM_MIN_INTERVAL_SEC apart, never for a consented or unsubscribed
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
import {
  FEED_AUDIENCE_VALUES,
  FEED_FIRM_SIZE_VALUES,
  FEED_FIRM_TYPE_VALUES,
  FEED_INTENDED_USE_VALUES,
  FEED_USE_VALUES,
  FEED_TERMS_VERSION,
  REFERRAL_CODE_RE,
  type FeedIntendedUse,
} from "@/lib/feed-waitlist";
import { sendFeedConfirmation, type FeedConfirmRow } from "@/lib/feed-email";
import {
  CONFIRM_MAX_SENDS,
  CONFIRM_MIN_INTERVAL_SEC,
  CONFIRM_WINDOW_SEC,
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
const CONFIRM_MESSAGE_WITH_FEED =
  "Check your email. We sent a link to confirm your contact address. When you confirm it, we will ask the feed delivery address to confirm too.";
const INTEREST_MESSAGE =
  "Thank you. We have noted your interest. We will not email you about the feed unless you tick the email box.";

const TERMS_MESSAGE = "Please accept the free edition terms to join.";

/** null for an absent value; undefined for a value outside `allowed` (the caller answers 400). */
function optionalChoice(v: unknown, allowed: readonly string[]): string | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "string" && allowed.includes(v) ? v : undefined;
}

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
  const feedRaw = typeof body.feed_email === "string" ? body.feed_email.trim().toLowerCase() : "";
  const reply = {
    ok: true,
    message: !wantsEmails ? INTEREST_MESSAGE : feedRaw ? CONFIRM_MESSAGE_WITH_FEED : CONFIRM_MESSAGE,
  };

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

  // A delivery address equal to the contact address means one address, which is the default.
  let feedEmail: string | null = null;
  if (feedRaw) {
    if (feedRaw.length > MAX_EMAIL || !EMAIL_RE.test(feedRaw)) {
      return NextResponse.json(
        { error: "Invalid feed_email", message: "Enter a valid feed delivery address, or leave it blank." },
        { status: 400, headers: NO_STORE },
      );
    }
    if (feedRaw !== email) feedEmail = feedRaw;
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

  if (body.terms_accepted !== true) {
    return NextResponse.json({ error: "Terms not accepted", message: TERMS_MESSAGE }, { status: 400, headers: NO_STORE });
  }

  const firmType = optionalChoice(body.firm_type, FEED_FIRM_TYPE_VALUES);
  const firmSize = optionalChoice(body.firm_size, FEED_FIRM_SIZE_VALUES);
  const audience = optionalChoice(body.audience, FEED_AUDIENCE_VALUES);
  const usesRaw = body.uses == null ? [] : body.uses;
  const uses =
    Array.isArray(usesRaw) && usesRaw.every((u) => typeof u === "string" && FEED_USE_VALUES.includes(u))
      ? [...new Set(usesRaw as string[])]
      : undefined;
  if (firmType === undefined || firmSize === undefined || audience === undefined || uses === undefined) {
    return NextResponse.json(
      { error: "Invalid profile", message: "One of the profile answers is not on the list. Please choose again." },
      { status: 400, headers: NO_STORE },
    );
  }
  const refCode = typeof body.ref === "string" && REFERRAL_CODE_RE.test(body.ref.trim().toLowerCase())
    ? body.ref.trim().toLowerCase()
    : null;

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

    // Referral: the referrer's row id, when the code exists. A lookup failure only drops the referral.
    let referredBy: string | null = null;
    if (refCode) {
      const { data: refRow, error: refError } = await admin
        .from("feed_waitlist")
        .select("id")
        .eq("referral_code", refCode)
        .maybeSingle();
      if (refError) console.error("[feed-waitlist] referral_lookup_failed", safeErrorCode(refError));
      referredBy = (refRow as { id?: string } | null)?.id ?? null;
    }

    // A new row never carries consent. An existing row is left exactly as it was.
    const { error } = await admin.from("feed_waitlist").upsert(
      {
        email,
        name: optionalText(body.name),
        company: optionalText(body.company),
        role: optionalText(body.role),
        intended_use: intendedUse,
        firm_type: firmType,
        firm_size: firmSize,
        uses,
        audience,
        heard_about: optionalText(body.heard_about),
        consent_feed_emails: false,
        consented_at: null,
        // Only when the box is ticked, and only ever on a new row: an existing row is never changed.
        requested_feed_email: wantsEmails ? feedEmail : null,
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
        p_window_seconds: CONFIRM_WINDOW_SEC,
        // Applied only if the owner confirms the email this claim sends.
        p_from_submission: true,
        p_terms_version: FEED_TERMS_VERSION,
        p_marketing_opt_in: body.marketing_opt_in === true,
        p_referred_by: referredBy,
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
    // Shown in the contact's confirmation email so its owner can see the address before agreeing. It is the
    // address STORED on the row (returned by the claim), never this request's: a repeat signup that omits or
    // changes feed_email must not hide the address that confirming would actually act on.
    const pendingFeed = row.requested_feed_email ?? null;
    // Queued, not awaited: a provider round trip here would make a first signup slower than a
    // repeat one, and the difference would reveal who is already listed.
    after(async () => {
      try {
        await sendFeedConfirmation(row, confirmToken, {
          requestedFeedEmail: pendingFeed,
          // The choice this email's link will apply, as stored by the claim.
          marketingOptIn: row.marketing_opt_in === true,
        });
      } catch (err) {
        console.error("[feed-waitlist] confirmation_email_failed", safeErrorCode(err));
      }
    });
  }

  return NextResponse.json(reply, { headers: NO_STORE });
}
