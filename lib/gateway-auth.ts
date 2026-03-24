/**
 * Gateway Auth — validates service-to-service requests to /api/data/* endpoints.
 *
 * Expects: Authorization: Bearer <RISKMODELS_API_SERVICE_KEY>
 *
 * Two modes:
 *   verifyGatewayAuth()  — "soft" auth: if a Bearer token is provided it must
 *                          be valid, but unauthenticated requests pass through.
 *                          Use for public read endpoints (symbols, history, etc.)
 *
 *   requireGatewayAuth() — "strict" auth: a valid Bearer token is required.
 *                          Use for write/admin endpoints (Phase 2+).
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * Soft auth — allows unauthenticated requests through, but rejects
 * requests that provide an invalid token. Returns null to proceed.
 */
export function verifyGatewayAuth(request: NextRequest): NextResponse | null {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;

  // If no service key is set, allow all requests (dev mode)
  if (!key) return null;

  const authHeader = request.headers.get("authorization");

  // No token provided — allow through (public read access)
  if (!authHeader) return null;

  // Token provided — validate it
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== key) {
    return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
  }

  return null;
}

/**
 * Strict auth — requires a valid Bearer token. Use for non-public endpoints.
 */
export function requireGatewayAuth(request: NextRequest): NextResponse | null {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;

  if (!key) return null;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 },
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== key) {
    return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
  }

  return null;
}
