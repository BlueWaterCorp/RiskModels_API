/**
 * POST /api/oauth/revoke — OAuth 2.0 token revocation (RFC 7009).
 *
 * Accepts an access token (a scoped rm_user_* key) or a refresh token and
 * revokes it. Per RFC 7009 the endpoint returns 200 whether or not the token
 * existed (only a missing `token` param is a 400 invalid_request).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/user-api-keys";
import { sha256 } from "@/lib/oauth/server";
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

export async function POST(req: NextRequest) {
  const rl = await rateLimit("revoke", clientIp(req), 60, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { ...CORS, "Cache-Control": "no-store", "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await parseBody(req);
  const token = body.token;
  if (!token) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing token parameter" },
      { status: 400, headers: { ...CORS, "Cache-Control": "no-store" } },
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  try {
    if (token.startsWith("rm_user_")) {
      // Access token — a scoped user key.
      await admin
        .from("user_generated_api_keys")
        .update({ revoked_at: now })
        .eq("key_hash", hashApiKey(token))
        .is("revoked_at", null);
    } else {
      // Opaque refresh token.
      await admin
        .from("oauth_refresh_tokens")
        .update({ revoked_at: now })
        .eq("token_hash", sha256(token))
        .is("revoked_at", null);
    }
  } catch (e) {
    console.error("[oauth/revoke] revoke failed:", e);
    // RFC 7009: still return 200 to avoid leaking token validity.
  }

  return NextResponse.json({}, { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } });
}
