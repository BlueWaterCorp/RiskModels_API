import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { loadPublicLedgerSnapshot } from "@/lib/event-ledger-public-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const latest = unstable_cache(loadPublicLedgerSnapshot, ["event-ledger-public-v1"], { revalidate: 300 });

/** Public presentation export, using exactly the daily edition's publication gate. */
export async function GET() {
  try {
    return NextResponse.json(await latest(), {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Event Ledger temporarily unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
