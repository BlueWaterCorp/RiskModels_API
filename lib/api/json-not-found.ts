import { NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/api-response";

/**
 * JSON 404 for unknown `/api/*` paths (avoid Next.js HTML 404 for API clients).
 */
export function apiRouteNotFoundJson(
  apiPath: string,
  requestId: string,
  method: string,
): NextResponse {
  return createErrorResponse(
    "not_found",
    `No route matches ${method} /api${apiPath === "" ? "" : "/" + apiPath}`,
    404,
    { path: `/api${apiPath === "" ? "" : "/" + apiPath}`, method },
    requestId,
  );
}
