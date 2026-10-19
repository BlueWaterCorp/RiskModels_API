/**
 * Conventional hosted MCP endpoint — `GET/POST /api/mcp`.
 *
 * This is a stable alias for clients that assume the standard bare MCP path.
 * It uses the same tool surface, auth, transport and handlers as
 * `/api/mcp/openai`; the named `/openai` and `/sse` routes remain supported.
 */

import { createMcpRouteHandlers } from "@/lib/mcp/http-handler";
import { ROOT_MCP_PATH } from "@/lib/mcp/openai-surface";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createMcpRouteHandlers({
  surface: "openai",
  oauthMetadataPath: `/.well-known/oauth-protected-resource${ROOT_MCP_PATH}`,
  logTag: "mcp-root",
});

export const POST = handlers.POST;
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
