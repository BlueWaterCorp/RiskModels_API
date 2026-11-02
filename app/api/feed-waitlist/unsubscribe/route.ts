/**
 * Security master feed: unsubscribe
 *
 * POST /api/feed-waitlist/unsubscribe?token=<uuid>
 *   - RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click` as a
 *     form body to the URL in the List-Unsubscribe header (lib/feed-email.ts).
 *   - The /security-master-feed/unsubscribe page POSTs JSON { token }.
 *
 * Sets unsubscribed_at on the matching public.feed_waitlist row (first use
 * only). The reply is the same whether or not the token matched a row, so it
 * cannot be used to test which tokens exist. GET is not supported: link
 * scanners fetch URLs, and a GET must never unsubscribe anyone.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 3600;

async function readToken(req: NextRequest): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
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
  const rl = await rateLimit("feed-waitlist-unsubscribe", clientIp(req), RATE_LIMIT, RATE_WINDOW_SEC);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const token = (await readToken(req))?.trim() ?? "";
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Invalid unsubscribe link." }, { status: 400, headers: NO_STORE });
  }

  try {
    const { error } = await createAdminClient()
      .from("feed_waitlist")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("unsubscribe_token", token.toLowerCase())
      .is("unsubscribed_at", null);
    if (error) {
      console.error("[feed-waitlist/unsubscribe] update failed:", error.message);
      return NextResponse.json(
        { error: "Could not save. Please reply to the email to unsubscribe." },
        { status: 503, headers: NO_STORE },
      );
    }
  } catch (err) {
    console.error("[feed-waitlist/unsubscribe] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not save. Please reply to the email to unsubscribe." },
      { status: 503, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
