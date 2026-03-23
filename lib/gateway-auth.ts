/**
 * Gateway Auth — validates service-to-service requests to /api/data/* endpoints.
 *
 * Expects: Authorization: Bearer <RISKMODELS_API_SERVICE_KEY>
 *
 * Preferred env var on RiskModels_API: RISKMODELS_API_SERVICE_KEY.
 * Legacy alias supported during migration: GATEWAY_SERVICE_KEY.
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * Returns a 401 NextResponse if the request is not authorized,
 * or null if the request is valid.
 *
 * Usage in route handlers:
 *   const denied = verifyGatewayAuth(request);
 *   if (denied) return denied;
 */
export function verifyGatewayAuth(request: NextRequest): NextResponse | null {
  const key =
    process.env.RISKMODELS_API_SERVICE_KEY ?? process.env.GATEWAY_SERVICE_KEY;

  // If no service key is set, allow all requests (dev mode)
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
    return NextResponse.json(
      { error: "Invalid service key" },
      { status: 401 },
    );
  }

  return null;
}
