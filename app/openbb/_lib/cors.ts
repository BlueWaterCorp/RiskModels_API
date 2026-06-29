/**
 * CORS for the OpenBB Workspace adapter.
 *
 * OpenBB Workspace (pro.openbb.co) calls a custom backend cross-origin and
 * requires the backend to (a) echo the Workspace origin and (b) permit the
 * auth header the user configured. We pass the user's RiskModels key through
 * the `X-API-KEY` header, so it must be in Access-Control-Allow-Headers.
 *
 * This is deliberately separate from the shared `@/lib/cors` (which gates the
 * public /api surface to riskmodels.app / .net origins) — the OpenBB origins
 * have no business being allowed on the rest of the API.
 */

const OPENBB_ORIGINS = [
  "https://pro.openbb.co",
  "https://my.openbb.co",
];

export function openbbCors(requestOrigin?: string | null): Record<string, string> {
  const isDev = process.env.NODE_ENV === "development";
  const allowed = [...OPENBB_ORIGINS];
  if (isDev) allowed.push("http://localhost:1420", "http://localhost:5050");

  const origin =
    requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-KEY",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
