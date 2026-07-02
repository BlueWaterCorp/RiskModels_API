/**
 * CORS for the OpenBB Workspace adapter.
 *
 * OpenBB Workspace (pro.openbb.co) calls a custom backend cross-origin, with
 * credentials, and attaches custom headers: the user's RiskModels key as
 * `X-API-KEY` plus `X-OpenBB-User` (the Workspace account email). The browser
 * preflights these, so EVERY header OpenBB sends must appear in
 * Access-Control-Allow-Headers or the browser blocks the real request — which
 * shows up as a generic 500 in the Connect dialog.
 *
 * Credentialed CORS forbids the "*" wildcard for Allow-Headers, so we echo back
 * the browser's `Access-Control-Request-Headers` (the standard robust pattern)
 * and fall back to the known set for non-preflight calls. This way any header
 * OpenBB adds in future (telemetry, tracing, …) is permitted without a code
 * change.
 *
 * Deliberately separate from the shared `@/lib/cors` (which gates the public
 * /api surface to riskmodels.app / .net origins) — the OpenBB origins have no
 * business being allowed on the rest of the API.
 */

const OPENBB_ORIGINS = ["https://pro.openbb.co", "https://my.openbb.co"];

// Fallback for non-preflight requests (which carry no Access-Control-Request-
// Headers). Lists the headers OpenBB is known to send.
const DEFAULT_ALLOW_HEADERS =
  "Content-Type, Authorization, X-API-KEY, X-OpenBB-User";

type HeaderBearing = { headers: { get(name: string): string | null } };

export function openbbCors(
  req?: HeaderBearing | string | null,
): Record<string, string> {
  // Back-compat: callers may pass an origin string or the request itself.
  let requestOrigin: string | null = null;
  let requestedHeaders: string | null = null;
  if (typeof req === "string") {
    requestOrigin = req;
  } else if (req && req.headers) {
    requestOrigin = req.headers.get("origin");
    requestedHeaders = req.headers.get("access-control-request-headers");
  }

  const isDev = process.env.NODE_ENV === "development";
  const allowed = [...OPENBB_ORIGINS];
  if (isDev) allowed.push("http://localhost:1420", "http://localhost:5050");

  const origin =
    requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}
