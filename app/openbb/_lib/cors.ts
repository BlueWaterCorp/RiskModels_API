/**
 * CORS for the OpenBB Workspace adapter.
 *
 * OpenBB's backend contract requires at least these origins:
 *   - https://pro.openbb.co
 *   - https://pro.openbb.dev
 *   - http://localhost:1420  (desktop Workspace)
 *
 * Workspace calls the adapter cross-origin, with credentials, and attaches
 * custom headers: the user's RiskModels key as `X-API-KEY` plus
 * `X-OpenBB-User` (the Workspace account email). The browser preflights
 * these, so EVERY header OpenBB sends must appear in
 * Access-Control-Allow-Headers or the browser blocks the real request —
 * which shows up as a generic 500 in the Connect dialog.
 *
 * Credentialed CORS forbids the "*" wildcard for Allow-Origin, so we echo
 * the request Origin when it is an OpenBB origin. We also echo the browser's
 * `Access-Control-Request-Headers` (the standard robust pattern) and fall
 * back to the known set for non-preflight calls. This way any header OpenBB
 * adds in future (telemetry, tracing, …) is permitted without a code change.
 *
 * If Origin is present but not allowed, we omit Allow-Origin rather than
 * falling back to pro.openbb.co — a mismatched Allow-Origin is a CORS
 * failure (this used to break pro.openbb.dev whenever the matcher missed).
 *
 * Deliberately separate from the shared `@/lib/cors` (which gates the public
 * /api surface to riskmodels.app / .net origins) — the OpenBB origins have no
 * business being allowed on the rest of the API.
 */

const DEFAULT_ORIGIN = "https://pro.openbb.co";

/** Origins named in OpenBB's backend contract. Trailing slashes stripped. */
const REQUIRED_ORIGINS = new Set([
  "https://pro.openbb.co",
  "https://pro.openbb.dev",
  "http://localhost:1420",
]);

export function normalizeOpenBBOrigin(o: string): string {
  return o.trim().replace(/\/+$/, "");
}

/**
 * True for OpenBB Workspace (and local desktop) origins.
 * Nested subdomains (`app.pro.openbb.co`) and trailing slashes are allowed.
 */
export function isOpenBBOrigin(o: string): boolean {
  const origin = normalizeOpenBBOrigin(o);
  if (REQUIRED_ORIGINS.has(origin)) return true;
  return (
    /^https:\/\/([a-z0-9-]+\.)*openbb\.(co|dev)$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin)
  );
}

// Fallback for non-preflight requests (which carry no Access-Control-Request-
// Headers). Lists the headers OpenBB is known to send.
const DEFAULT_ALLOW_HEADERS =
  "Content-Type, Authorization, X-API-KEY, X-OpenBB-User";

const ALLOW_METHODS = "GET, POST, OPTIONS, PUT, PATCH, DELETE, HEAD";

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

  const normalized = requestOrigin ? normalizeOpenBBOrigin(requestOrigin) : null;
  const allowed =
    normalized && isOpenBBOrigin(normalized) ? normalized : null;

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": requestedHeaders || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Headers",
  };

  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
  } else if (!requestOrigin) {
    // No Origin (curl / server-side). Advertise the production Workspace origin
    // so a header dump still shows CORS is configured.
    headers["Access-Control-Allow-Origin"] = DEFAULT_ORIGIN;
  }

  return headers;
}
