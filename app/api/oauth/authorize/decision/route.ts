/**
 * POST /api/oauth/authorize/decision — handles the consent screen submission.
 *
 * Re-validates the client + redirect_uri server-side (never trusts the hidden
 * form fields for security decisions) and re-derives the user from the session
 * cookie. On "approve" it mints a single-use, PKCE-bound authorization code and
 * 303-redirects back to the client's redirect_uri with `code` + `state`.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureStarterCredits } from "@/lib/agent/billing";
import {
  getClient,
  redirectUriRegistered,
  sha256,
  randomToken,
  AUTH_CODE_TTL_MS,
  OAUTH_SCOPE,
} from "@/lib/oauth/server";

export const dynamic = "force-dynamic";

function redirectTo(redirectUri: string, params: Record<string, string>): NextResponse {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return NextResponse.redirect(u.toString(), { status: 303 });
}

export async function POST(req: NextRequest) {
  // CSRF defense-in-depth: the consent form is same-origin. Reject cross-site
  // POSTs (Supabase cookies are SameSite=Lax, but don't rely on that alone — a
  // forged approve would mint a code for an attacker's client on the victim's
  // session).
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return new NextResponse("Cross-site request rejected", { status: 403 });
      }
    } catch {
      return new NextResponse("Invalid origin", { status: 403 });
    }
  }

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const codeChallengeMethod = String(form.get("code_challenge_method") ?? "S256");
  const scope = String(form.get("scope") ?? OAUTH_SCOPE);
  const state = String(form.get("state") ?? "");
  const decision = String(form.get("decision") ?? "");

  // Re-validate client + redirect_uri against the DB — the form is attacker-controllable.
  const client = await getClient(clientId);
  if (!client || !redirectUriRegistered(client, redirectUri)) {
    return new NextResponse("Invalid client or redirect_uri", { status: 400 });
  }

  if (decision !== "approve") {
    return redirectTo(redirectUri, { error: "access_denied", state });
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectTo(redirectUri, { error: "invalid_request", error_description: "PKCE S256 required", state });
  }

  // User identity comes from the session cookie, never the form.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Session lost mid-flow — re-enter authorize, which routes to sign-in.
    const qs = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      state,
    });
    return NextResponse.redirect(new URL(`/oauth/authorize?${qs.toString()}`, req.url), { status: 303 });
  }

  // Ensure a billing account exists so the token minted from this code can charge.
  try {
    await ensureStarterCredits(user.id);
  } catch (e) {
    console.error("[oauth/decision] ensureStarterCredits failed:", e);
  }

  const code = randomToken(32);
  const admin = createAdminClient();
  const { error } = await admin.from("oauth_auth_codes").insert({
    code_hash: sha256(code),
    user_id: user.id,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[oauth/decision] auth code insert failed:", error.message);
    return new NextResponse("server_error", { status: 500 });
  }

  return redirectTo(redirectUri, { code, state });
}
