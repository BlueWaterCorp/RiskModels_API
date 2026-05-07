import type { NextRequest } from "next/server";
import { apiRouteNotFoundJson } from "@/lib/api/json-not-found";
import { getRequestId } from "@/lib/api/request-id";

/**
 * Catch-all for unknown /api/* paths so clients get JSON (not Next.js HTML 404).
 * Specific routes under app/api take precedence (each has its own route.ts).
 */
export const dynamic = "force-dynamic";

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const suffix = Array.isArray(path) ? path.join("/") : "";
  const rid = getRequestId(request);
  return apiRouteNotFoundJson(suffix, rid, request.method);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
