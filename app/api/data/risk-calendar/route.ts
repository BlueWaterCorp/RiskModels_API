import { NextResponse } from "next/server";
import { RISK_CALENDAR_RETIRED_BODY } from "@/lib/api/retired-endpoints";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/risk-calendar — RETIRED.
 *
 * The Risk Calendar (T.6: earnings, ex-dividend, macro and filing-deadline
 * events from the `risk_events` table) was retired by product decision. The
 * route stays so existing callers get a documented, permanent answer instead
 * of a generic 404: HTTP 410 Gone with error code `risk_calendar_retired`.
 * The chat tool `get_risk_calendar` and lib/risk/risk-calendar-service.ts are
 * removed. Filing deadlines remain available at GET /api/data/filing-calendar.
 */
function gone() {
  return NextResponse.json(RISK_CALENDAR_RETIRED_BODY, {
    status: 410,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

export async function GET() {
  return gone();
}

export async function HEAD() {
  return new NextResponse(null, { status: 410 });
}
