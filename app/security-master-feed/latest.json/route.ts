import { NextResponse } from "next/server";
import { cachedLedgerExports } from "@/lib/event-ledger-public-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Public sample of the Event Ledger: a few events, none publicly known after
 * `sample_through`, behind exactly the daily edition's publication gate. The
 * current export is served only to an approved subscriber's credential
 * (/security-master-feed/private/latest.json).
 */
export async function GET() {
  try {
    return NextResponse.json((await cachedLedgerExports()).sample, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Event Ledger temporarily unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
