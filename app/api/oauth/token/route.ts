/**
 * POST /api/oauth/token — OAuth token endpoint.
 *
 * Grants:
 *  - authorization_code: validates a single-use PKCE-bound code, consumes it,
 *    and issues an access token. The access token IS a scoped `rm_user_*` key
 *    minted into user_generated_api_keys, so it authenticates at /api/mcp/sse
 *    via the existing validateApiKey path with no resource-server changes.
 *  - refresh_token: rotates the refresh token and issues a fresh access token.
 *
 * Public clients (token_endpoint_auth_method "none") — no client_secret; the
 * authorization_code grant is bound to the client via PKCE.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUserApiKey } from "@/lib/user-api-keys";
import { ensureStarterCredits } from "@/lib/agent/billing";
import {
  sha256,
  randomToken,
  verifyPkceS256,
  getClient,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_MS,
  KEY_SCOPES,
} from "@/lib/oauth/server";
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

function tokenError(error: string, desc?: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, ...(desc ? { error_description: desc } : {}) },
    { status, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  form.forEach((v, k) => {
    out[k] = String(v);
  });
  return out;
}

/** Mint a scoped rm_user_* access token + a rotating refresh token. */
async function issueTokens(userId: string, clientId: string, clientName: string | null, scope: string) {
  const admin = createAdminClient();
  try {
    await ensureStarterCredits(userId);
  } catch (e) {
    console.error("[oauth/token] ensureStarterCredits failed:", e);
  }

  const { plainKey, hashedKey, prefix } = generateUserApiKey("live");
  const { error: keyErr } = await admin.from("user_generated_api_keys").insert({
    user_id: userId,
    key_hash: hashedKey,
    key_prefix: prefix,
    name: `MCP OAuth${clientName ? `: ${clientName}` : ""}`,
    scopes: KEY_SCOPES,
    expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
  });
  if (keyErr) throw new Error(`access key insert: ${keyErr.message}`);

  const refresh = randomToken(32);
  const { error: refErr } = await admin.from("oauth_refresh_tokens").insert({
    token_hash: sha256(refresh),
    user_id: userId,
    client_id: clientId,
    scope,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  if (refErr) throw new Error(`refresh token insert: ${refErr.message}`);

  return NextResponse.json(
    {
      access_token: plainKey,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refresh,
      scope,
    },
    { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  // Anti-abuse: cap token exchanges per IP (also blunts auth-code / refresh brute force).
  const rl = await rateLimit("token", clientIp(req), 60, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests", error_description: "Token rate limit exceeded." },
      { status: 429, headers: { ...CORS, "Cache-Control": "no-store", "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await parseBody(req);
  const grantType = body.grant_type;
  const admin = createAdminClient();

  // ----- authorization_code + PKCE -----
  if (grantType === "authorization_code") {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return tokenError("invalid_request", "Missing code, redirect_uri, client_id, or code_verifier");
    }

    const { data: codeRow } = await admin
      .from("oauth_auth_codes")
      .select("id, user_id, client_id, redirect_uri, code_challenge, scope, expires_at, consumed_at")
      .eq("code_hash", sha256(code))
      .maybeSingle();

    if (!codeRow) return tokenError("invalid_grant", "Authorization code not found");
    if (codeRow.consumed_at) return tokenError("invalid_grant", "Authorization code already used");
    if (new Date(codeRow.expires_at) < new Date()) return tokenError("invalid_grant", "Authorization code expired");
    if (codeRow.client_id !== clientId) return tokenError("invalid_grant", "client_id mismatch");
    if (codeRow.redirect_uri !== redirectUri) return tokenError("invalid_grant", "redirect_uri mismatch");
    if (!verifyPkceS256(codeVerifier, codeRow.code_challenge)) {
      return tokenError("invalid_grant", "PKCE verification failed");
    }

    // Single-use: consume atomically (guard on consumed_at IS NULL to block replay/race).
    const { data: consumed } = await admin
      .from("oauth_auth_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", codeRow.id)
      .is("consumed_at", null)
      .select("id");
    if (!consumed || consumed.length === 0) return tokenError("invalid_grant", "Authorization code already used");

    const client = await getClient(clientId);
    try {
      return await issueTokens(codeRow.user_id, clientId, client?.client_name ?? null, codeRow.scope);
    } catch (e) {
      console.error("[oauth/token] issue (code) failed:", e);
      return tokenError("server_error", undefined, 500);
    }
  }

  // ----- refresh_token (rotating) -----
  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token;
    const clientId = body.client_id;
    if (!refreshToken || !clientId) return tokenError("invalid_request", "Missing refresh_token or client_id");

    const { data: row } = await admin
      .from("oauth_refresh_tokens")
      .select("id, user_id, client_id, scope, expires_at, revoked_at")
      .eq("token_hash", sha256(refreshToken))
      .maybeSingle();

    if (row?.revoked_at) {
      // Replay of an already-rotated refresh token is a theft signal (RFC 6819
      // §5.2.2.3): revoke the whole family for this user+client so neither party
      // can keep refreshing.
      try {
        await admin
          .from("oauth_refresh_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("user_id", row.user_id)
          .eq("client_id", row.client_id)
          .is("revoked_at", null);
      } catch (e) {
        console.error("[oauth/token] family revoke on replay failed:", e);
      }
      return tokenError("invalid_grant", "Refresh token invalid");
    }
    if (!row) return tokenError("invalid_grant", "Refresh token invalid");
    if (new Date(row.expires_at) < new Date()) return tokenError("invalid_grant", "Refresh token expired");
    if (row.client_id !== clientId) return tokenError("invalid_grant", "client_id mismatch");

    // Rotate: revoke the presented refresh token before issuing a new pair.
    const { data: revoked } = await admin
      .from("oauth_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("revoked_at", null)
      .select("id");
    if (!revoked || revoked.length === 0) return tokenError("invalid_grant", "Refresh token already used");

    const client = await getClient(clientId);
    try {
      return await issueTokens(row.user_id, clientId, client?.client_name ?? null, row.scope);
    } catch (e) {
      console.error("[oauth/token] issue (refresh) failed:", e);
      return tokenError("server_error", undefined, 500);
    }
  }

  return tokenError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(none)"}`);
}
