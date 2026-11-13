/**
 * Event Ledger: confirm a team-inbox request
 *
 * POST /api/feed-waitlist/delivery/confirm   { token }
 *
 * `token` is the single-use value from emails/feed-delivery-change.tsx, sent
 * to the contact's own address. feed_waitlist_confirm_delivery_change() (one
 * transaction) creates the inbox row if needed, links it, records whether the
 * contact's own address stops receiving once the inbox confirms, and clears
 * the request. It matches nothing for an unknown, used or expired token or an
 * unsubscribed contact. After the response the inbox is asked to confirm for
 * itself (lib/feed-delivery.ts); until it does, the contact keeps receiving.
 *
 * The page /security-master-feed/delivery/confirm asks for a click before
 * posting here, so a mail scanner fetching the link changes nothing.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";
import { CONFIRM_TOKEN_RE, hashConfirmToken } from "@/lib/feed-token";
import { askDeliveryAddressToConfirm } from "@/lib/feed-delivery";
import { safeErrorCode } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 3600;
const INVALID = {
  error: "Invalid or expired link",
  message: "This link is invalid or has expired. Use the team inbox link in a newer edition.",
};

interface Changed {
  id: string;
  email: string;
  name: string | null;
  unsubscribe_token: string;
  feed_email: string;
  linked: boolean;
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit("feed-waitlist-delivery-confirm", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  let token = "";
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && "token" in body && typeof (body as { token: unknown }).token === "string") {
      token = ((body as { token: string }).token ?? "").trim();
    }
  } catch {
    token = "";
  }
  if (!CONFIRM_TOKEN_RE.test(token)) return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });

  const admin = createAdminClient();
  let changed: Changed | null = null;
  try {
    const { data, error } = await admin.rpc("feed_waitlist_confirm_delivery_change", {
      p_token_hash: hashConfirmToken(token),
    });
    if (error) {
      console.error("[feed-waitlist/delivery/confirm] confirm_failed", safeErrorCode(error));
      return NextResponse.json(
        { error: "Could not save", message: "Could not save. Please try again shortly." },
        { status: 503, headers: NO_STORE },
      );
    }
    changed = Array.isArray(data) && data.length > 0 ? (data[0] as Changed) : null;
  } catch (err) {
    console.error("[feed-waitlist/delivery/confirm] unexpected_error", safeErrorCode(err));
    return NextResponse.json(
      { error: "Could not save", message: "Could not save. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!changed) return NextResponse.json(INVALID, { status: 400, headers: NO_STORE });

  const row = changed;
  if (row.linked) {
    after(async () => {
      try {
        await askDeliveryAddressToConfirm(admin, row.feed_email, { email: row.email, name: row.name });
      } catch (err) {
        console.error("[feed-waitlist/delivery/confirm] inbox_confirmation_failed", safeErrorCode(err));
      }
    });
  }

  // linked false: the address already belongs to a contact of its own, so it is never linked as someone's inbox.
  return NextResponse.json({ ok: true, linked: row.linked }, { headers: NO_STORE });
}
