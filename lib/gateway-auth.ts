/**
 * Gateway Auth — validates service-to-service requests to /api/data/* endpoints.
 *
 * Expects: Authorization: Bearer <RISKMODELS_API_SERVICE_KEY>
 *
 * Two modes:
 *   verifyGatewayAuth()  — "soft" auth: unauthenticated requests pass through.
 *                          User API keys (rm_agent_* / rm_user_*) and other Bearer
 *                          tokens must NOT be rejected — only the service key
 *                          grants elevated gateway role; everything else is treated
 *                          as public read (same as omitting Authorization).
 *
 *   requireGatewayAuth() — "strict" auth: a valid Bearer token is required.
 *                          Use for write/admin endpoints (Phase 2+).
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * Soft auth — public read. Invalid *service* keys do not block access; behavior
 * matches anonymous. Matching service key can be used for observability later.
 */
export function verifyGatewayAuth(request: NextRequest): NextResponse | null {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;

  if (!key) return null;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token === key) return null;

  // User keys, JWTs, or any other Bearer: allow public read (do not 401).
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

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token !== key) {
    return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
  }

  return null;
}
