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

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Absolute URI (https, or any scheme:// e.g. custom-app or http://localhost loopback).
function isAbsoluteUri(u: unknown): u is string {
  return typeof u === "string" && /^[a-z][a-z0-9+.-]*:\/\/.+/i.test(u);
}

export async function POST(req: NextRequest) {
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
