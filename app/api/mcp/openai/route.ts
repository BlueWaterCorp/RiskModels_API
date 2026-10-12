/**
 * Hosted MCP endpoint — `GET/POST /api/mcp/openai` (OpenAI tool surface).
 *
 * Same auth, transport and handlers as `/api/mcp/sse`; the tool surface
 * differs (no generic REST reader, explicit read-only tools, renamed
 * residual-returns and documentation tools). See lib/mcp/openai-surface.ts.
 */

import { createMcpRouteHandlers } from "@/lib/mcp/http-handler";
import { OPENAI_MCP_PATH } from "@/lib/mcp/openai-surface";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createMcpRouteHandlers({
  surface: "openai",
  oauthMetadataPath: `/.well-known/oauth-protected-resource${OPENAI_MCP_PATH}`,
  logTag: "mcp-openai",
});

export const POST = handlers.POST;
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
