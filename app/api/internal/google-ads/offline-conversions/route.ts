/**
 * GET /api/internal/google-ads/offline-conversions
 *
 * Phase-2 activation tracking: emits a Google Ads "scheduled upload" CSV of offline
 * click-conversions for accounts that have **used** an API key (activation), keyed on the
 * Google click id (gclid) captured at sign-up.
 *
 * Point a Google Ads scheduled upload (HTTPS source) at this URL. Google Ads dedupes
 * offline conversions by (Google Click ID, Conversion Name, Conversion Time), so we emit a
 * rolling window each pull and a stable conversion time — re-emitting the same activation is
 * a no-op on Google's side.
 *
 * Auth (any of): `Authorization: Bearer <token>`, HTTP Basic auth password == token, or
 * `?token=<token>`. Token = env GOOGLE_ADS_OFFLINE_UPLOAD_TOKEN.
 *
 * Conversion action name MUST match the Google Ads action exactly: "Activation - first API use".
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Must exactly match the conversion action name created in Google Ads. */
const CONVERSION_NAME = "Activation - first API use";
const CONVERSION_VALUE = "1";
const CONVERSION_CURRENCY = "USD";
const DEFAULT_WINDOW_DAYS = 60;

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Accept Bearer, Basic (password), or ?token= — Google Ads scheduled uploads use Basic auth. */
function authorize(request: NextRequest): boolean {
  const secret = process.env.GOOGLE_ADS_OFFLINE_UPLOAD_TOKEN?.trim();
  if (!secret) return false;

  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    return timingSafeEqual(auth.slice(7).trim(), secret);
  }
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const password = decoded.slice(decoded.indexOf(":") + 1);
      return timingSafeEqual(password, secret);
    } catch {
      return false;
    }
  }
  const qToken = request.nextUrl.searchParams.get("token");
  if (qToken) return timingSafeEqual(qToken, secret);
  return false;
}

/** ISO timestamp → "YYYY-MM-DD HH:MM:SS" in UTC (paired with Parameters:TimeZone=+0000). */
function formatConversionTime(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const windowDays =
    Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 90
      ? Math.floor(daysRaw)
      : DEFAULT_WINDOW_DAYS;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("agent_accounts")
    .select("signup_attribution")
    .not("signup_attribution->>gclid", "is", null)
    .not("signup_attribution->>first_api_use_at", "is", null);

  if (error) {
    console.error("[offline-conversions] query failed:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const lines: string[] = [
    "Parameters:TimeZone=+0000",
    "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
  ];

  for (const row of rows ?? []) {
    const attr = (row.signup_attribution ?? {}) as Record<string, unknown>;
    const gclid = typeof attr.gclid === "string" ? attr.gclid : null;
    const firstUse =
      typeof attr.first_api_use_at === "string" ? attr.first_api_use_at : null;
    if (!gclid || !firstUse) continue;

    const t = Date.parse(firstUse);
    if (Number.isNaN(t) || t < cutoff) continue; // outside rolling window

    lines.push(
      [
        gclid,
        CONVERSION_NAME,
        formatConversionTime(firstUse),
        CONVERSION_VALUE,
        CONVERSION_CURRENCY,
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition":
        'attachment; filename="google-ads-activation-conversions.csv"',
    },
  });
}
