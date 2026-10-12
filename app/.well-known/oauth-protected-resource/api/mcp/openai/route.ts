/**
 * GET /.well-known/oauth-protected-resource/api/mcp/openai
 *
 * RFC 9728 protected-resource metadata for the OpenAI MCP surface. Same
 * authorization server as `/api/mcp/sse`; `resource` names this endpoint so
 * clients that check the resource against the URL they connected to accept
 * it. The 401 challenge on `/api/mcp/openai` points here.
 */
import { OPENAI_MCP_PATH } from "@/lib/mcp/openai-surface";
import { protectedResourceMetadata } from "@/lib/oauth/protected-resource";

export const dynamic = "force-dynamic";

export async function GET() {
  return protectedResourceMetadata(OPENAI_MCP_PATH);
}
