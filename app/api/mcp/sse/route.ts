/**
 * Hosted MCP endpoint — `GET/POST /api/mcp/sse` (default tool surface).
 *
 * This is the surface listed in the Anthropic MCP directory; its tool list
 * must stay unchanged. The OpenAI surface lives at `/api/mcp/openai`. Both
 * routes share the auth + Streamable HTTP handler in lib/mcp/http-handler.ts.
 */

import { createMcpRouteHandlers } from "@/lib/mcp/http-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro caps at 60s. Streamable HTTP in stateless mode closes after each
// POST request/response cycle — tool calls are sub-second in the common case.
// Raise this only after confirming the deployment tier supports longer.
export const maxDuration = 60;

const handlers = createMcpRouteHandlers({
  surface: "default",
  oauthMetadataPath: "/.well-known/oauth-protected-resource",
  logTag: "mcp-sse",
});

export const POST = handlers.POST;
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
