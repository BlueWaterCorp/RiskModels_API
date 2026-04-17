/**
 * GET /api/cron/notify-expiring-keys
 *
 * Vercel Cron (daily): remind users when API keys are 14 / 7 / 1 day(s) from expiry.
 * Auth: Authorization: Bearer CRON_SECRET (set in Vercel env; Vercel injects for Cron invocations).
 *
 * Manual: curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://riskmodels.app/api/cron/notify-expiring-keys"
 *
 * Email flow matches BWMACRO admin pattern: Resend + React Email (lib/email-service), audit BCC via sendResendEmail.
 */

import { NextRequest, NextResponse } from "next/server";
import { runNotifyExpiringApiKeys } from "@/lib/agent/notify-expiring-api-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotifyExpiringApiKeys();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/notify-expiring-keys]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
