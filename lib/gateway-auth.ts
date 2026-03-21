/**
 * Gateway Auth — validates service-to-service requests to /api/data/* endpoints.
 *
 * Expects: Authorization: Bearer <GATEWAY_SERVICE_KEY>
 *
 * The key is set via the GATEWAY_SERVICE_KEY env var on RiskModels_API.
 * Risk_Models sends it via RISKMODELS_API_SERVICE_KEY.
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
  const key = process.env.GATEWAY_SERVICE_KEY;

  // If GATEWAY_SERVICE_KEY is not set, allow all requests (dev mode)
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
