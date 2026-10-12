import { protectedResourceMetadata } from "@/lib/oauth/protected-resource";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 protected-resource metadata.
 *
 * Points MCP clients (Claude Desktop, Cursor) at the authorization server so the
 * native "Add custom connector by URL" flow can discover how to authenticate,
 * instead of failing at client registration against a presumed sign-in service.
 *
 * Phase A (MCP OAuth) — discovery surface only. The `/oauth/*` endpoints listed
 * in the authorization-server metadata land in Phases B (authorization_code +
 * PKCE + token) and C (Dynamic Client Registration). Tier-1 Bearer API keys
 * continue to work unchanged.
 */
export async function GET() {
  return protectedResourceMetadata("/api/mcp/sse");
}
