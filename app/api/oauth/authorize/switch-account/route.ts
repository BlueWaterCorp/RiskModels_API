/**
 * POST /api/oauth/authorize/switch-account — "Use a different account" on the
 * OAuth consent screen.
 *
 * Signs out the current Supabase session in this browser only (scope "local";
 * other devices keep their sessions) and 303-redirects to the sign-in step
 * (`/get-key?next=/oauth/authorize?...`) with every original authorize
 * parameter, so after signing in as the intended account the user lands back
 * on the consent screen for the same client, redirect_uri, state and PKCE
 * challenge. Nothing here mints codes or tokens.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { signInPathFor } from "@/lib/oauth/authorize-return";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Same-origin only: a cross-site POST could otherwise sign the user out.
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
  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) {
    if (typeof v === "string" && !params.has(k)) params.set(k, v);
  }

  const response = NextResponse.redirect(new URL(signInPathFor(params), req.url), { status: 303 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write the cleared sb-* cookies onto the redirect itself.
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.error("[oauth/switch-account] signOut failed:", error.message);
  }

  // If signOut could not clear the session (e.g. auth server unreachable), expire
  // the Supabase session cookies directly so the sign-in step starts signed out.
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith("sb-") && !response.cookies.get(c.name)) {
      response.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}
