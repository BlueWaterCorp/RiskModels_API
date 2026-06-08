/**
 * POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * MCP clients (Claude Desktop / Cursor) self-register here after discovering the
 * authorization server. Public clients only: no client_secret is issued; the
 * token endpoint relies on PKCE (token_endpoint_auth_method "none").
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Absolute redirect URI. Allow https and custom app schemes; for http require a
// loopback host (RFC 8252) so an authorization code is never delivered over
// cleartext to an arbitrary remote host.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
function isAbsoluteUri(u: unknown): u is string {
  if (typeof u !== "string" || !/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(u)) return false;
  try {
    const url = new URL(u);
    if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
    return true; // https or a custom (native-app) scheme
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Anti-abuse: cap dynamic client registrations per IP (DCR is infrequent).
  const rl = await rateLimit("register", clientIp(req), 30, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests", error_description: "Registration rate limit exceeded. Try again later." },
      { status: 429, headers: { ...CORS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON" },
      { status: 400, headers: CORS },
    );
  }

  const redirectUris = body?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(isAbsoluteUri)) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris must be a non-empty array of absolute URIs" },
      { status: 400, headers: CORS },
    );
  }

  const clientId = crypto.randomUUID();
  const clientName = typeof body?.client_name === "string" ? (body.client_name as string).slice(0, 200) : null;

  const admin = createAdminClient();
  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: clientName,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    metadata: body,
  });

  if (error) {
    console.error("[oauth/register] insert error:", error.message);
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: CORS });
  }

  // RFC 7591 client information response.
  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(clientName ? { client_name: clientName } : {}),
    },
    { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}
