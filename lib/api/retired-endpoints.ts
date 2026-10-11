/**
 * Bodies for retired endpoints (route files may only export Next.js route
 * fields, so the constants live here and are shared with tests).
 */

/** GET /api/data/risk-calendar — retired; answered with HTTP 410 Gone. */
export const RISK_CALENDAR_RETIRED_BODY = {
  error: "risk_calendar_retired",
  message:
    "The Risk Calendar endpoint has been retired and no longer returns events. SEC filing deadlines remain available at /api/data/filing-calendar.",
  code: 410,
} as const;
