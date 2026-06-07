/**
 * MCP OAuth authorization-server helpers (Phase B/C, backlog E.20).
 *
 * The access token issued by /api/oauth/token is a scoped `rm_user_*` key
 * (decision: mint under the hood — validateApiKey already accepts it at
 * /api/mcp/sse). These helpers cover the OAuth protocol state only:
 * client lookup, PKCE, and hashed single-use codes / refresh tokens.
 */
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** OAuth scope advertised in the AS metadata (`scopes_supported`). */
export const OAUTH_SCOPE = "mcp:read";
/** Underlying scope stamped on the minted rm_user_* key — what the REST API expects. */
export const KEY_SCOPES = ["read"];
export const AUTH_CODE_TTL_MS = 5 * 60_000; // 5 min
export const ACCESS_TOKEN_TTL_S = 3600; // 1 h
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 d

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** PKCE S256 check: base64url(sha256(verifier)) === challenge, constant-time. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name: string | null;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("oauth_clients")
    .select("client_id, redirect_uris, client_name")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

/** Exact-match the redirect_uri against the client's registered set (no prefix/substring matching). */
export function redirectUriRegistered(client: OAuthClient, redirectUri: string): boolean {
  return Array.isArray(client.redirect_uris) && client.redirect_uris.includes(redirectUri);
}
