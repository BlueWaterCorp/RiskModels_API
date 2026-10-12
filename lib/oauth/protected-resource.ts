import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/oauth/server";

/**
 * RFC 9728 protected-resource metadata for one hosted MCP endpoint. Served at
 * `/.well-known/oauth-protected-resource` (default `/api/mcp/sse`) and at the
 * path-suffixed variants for each MCP endpoint.
 */
export async function protectedResourceMetadata(resourcePath: string) {
  const base = await appOrigin();
  return NextResponse.json(
    {
      resource: `${base}${resourcePath}`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_documentation: `${base}/docs/agent-integration`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
