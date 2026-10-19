/**
 * RFC 9728 protected-resource metadata for the conventional `/api/mcp` alias.
 */
import { ROOT_MCP_PATH } from "@/lib/mcp/openai-surface";
import { protectedResourceMetadata } from "@/lib/oauth/protected-resource";

export const dynamic = "force-dynamic";

export async function GET() {
  return protectedResourceMetadata(ROOT_MCP_PATH);
}
