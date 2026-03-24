/**
 * CORS utilities for API routes
 */

export function getAllowedOrigins(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const isDev = process.env.NODE_ENV === "development";

  const origins: string[] = [
    "https://riskmodels.app",
    "https://www.riskmodels.app",
    "https://riskmodels.net"
  ];

  if (appUrl && !origins.includes(appUrl)) {
    origins.push(appUrl);
  }

  if (isDev) {
    origins.push("http://localhost:3000");
    origins.push("http://localhost:3001");
    origins.push("http://127.0.0.1:3000");
  }

  return origins;
}

export function getCorsHeaders(
  requestOrigin?: string | null,
): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();
  
  // Hardened base headers based on your review
  const baseHeaders = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin", // Critical for preventing CDN caching issues
  };

  // If request has an origin and it's allowed, echo it back
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return {
      ...baseHeaders,
      "Access-Control-Allow-Origin": requestOrigin,
    };
  }

  // Fallback to primary domain
  return {
    ...baseHeaders,
    "Access-Control-Allow-Origin": allowedOrigins[0],
  };
}