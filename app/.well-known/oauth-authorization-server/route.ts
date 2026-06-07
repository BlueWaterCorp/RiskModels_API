import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 authorization-server metadata.
 *
 * Advertised by the protected-resource metadata so an MCP client can run the
 * OAuth authorization-code + PKCE + Dynamic Client Registration flow against
 * this origin (`.app`). Sign-in reuses `.app`'s own Supabase Google/GitHub/
 * magic-link flow — `.net` (the no-code workspace) is never involved.
 *
 * Phase A FORWARD-DECLARES the endpoints below; they return 404 until:
 *   - Phase B: `/oauth/authorize` + `/api/oauth/token` (authorization_code + PKCE)
 *   - Phase C: `/api/oauth/register` (Dynamic Client Registration, RFC 7591)
 * This is intentional — Phase A only proves the discovery handshake is well-formed.
 */
export function GET() {
  const base = getAppUrl().replace(/\/$/, "");
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp:read"],
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
