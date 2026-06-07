import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

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
export function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  return NextResponse.json(
    {
      resource: `${base}/api/mcp/sse`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_documentation: `${base}/docs/agent-integration`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
