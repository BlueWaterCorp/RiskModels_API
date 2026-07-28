import { NextResponse, type NextRequest } from "next/server";
import {
  getRiskCalendar,
  type RiskCalendarEventType,
} from "@/lib/risk/risk-calendar-service";

export const dynamic = "force-dynamic";

const VALID_TYPES: RiskCalendarEventType[] = [
  "earnings",
  "ex_dividend",
  "macro",
  "filing_deadline",
];

/**
 * GET /api/data/risk-calendar
 *
 * Risk Calendar v1 (T.6) — portfolio-relevant events: earnings, ex-dividend
 * dates, macro releases (CPI / FOMC / payrolls), and SEC filing deadlines.
 * Backed by the `risk_events` table (ERM3 publish_risk_events asset) unioned
 * with `filing_calendar` at this layer.
 *
 * Optional filters:
 *   ?from=YYYY-MM-DD          — event_date >= from (default: today)
 *   ?to=YYYY-MM-DD            — event_date <= to (default: today + 30d)
 *   ?tickers=NVDA,AAPL        — scope ticker events to a portfolio
 *                                (macro + filing events always included);
 *                                adds a per-ticker `coverage` report
 *   ?types=earnings,macro     — restrict event types
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tickersParam = sp.get("tickers");
  const typesParam = sp.get("types");

  const types = typesParam
    ? (typesParam
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is RiskCalendarEventType =>
          (VALID_TYPES as string[]).includes(t),
        ) satisfies RiskCalendarEventType[])
    : undefined;

  try {
    const result = await getRiskCalendar({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      tickers: tickersParam ? tickersParam.split(",") : undefined,
      types,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[data/risk-calendar] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
