/**
 * CORS utilities for API routes
 */

/**
 * Get allowed CORS origins
 * In development, allow localhost. In production, only allow the app URL.
 */
export function getAllowedOrigins(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const isDev = process.env.NODE_ENV === "development";

  const origins: string[] = [];

  if (appUrl) {
    origins.push(appUrl);
  }

  // In development, also allow localhost variants
  if (isDev) {
    origins.push("http://localhost:3000");
    origins.push("http://localhost:3001");
    origins.push("http://127.0.0.1:3000");
  }

  return origins;
}

/**
 * Get CORS headers for API responses
 * Restricts to allowed origins only
 */
export function getCorsHeaders(
  requestOrigin?: string | null,
): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();

  // If request has an origin and it's in our allowlist, allow it
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // 24 hours
    };
  }

  // Default to first allowed origin (usually the app URL)
  const defaultOrigin =
    allowedOrigins[0] ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://riskmodels.net";

  return {
    "Access-Control-Allow-Origin": defaultOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
