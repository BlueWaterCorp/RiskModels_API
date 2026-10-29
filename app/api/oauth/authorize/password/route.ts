/**
 * POST /api/oauth/authorize/password — email + password sign-in for the
 * OAuth authorize page.
 *
 * Directory review (OpenAI, Anthropic) submits a dedicated account and must
 * finish sign-in without a magic link, email code, or a control that only
 * appears after JavaScript. This route checks the password, writes the
 * Supabase session onto the redirect, and returns to /oauth/authorize with
 * the original PKCE parameters so the consent screen can render.
 *
 * The return path is rebuilt from the known authorize parameters only. The
 * password is never placed on a URL, in a log line, or in a cookie name.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authorizeReturnPath } from "@/lib/oauth/authorize-return";
import { clientIp, rateLimit } from "@/lib/oauth/rate-limit";

export const dynamic = "force-dynamic";

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return new NextResponse("Cross-site request rejected", { status: 403 });
  }

  const form = await req.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string" && fields[k] === undefined) fields[k] = v;
  }

  const back = new URL(authorizeReturnPath(fields), req.url);
  const fail = (code: string) => {
    const u = new URL(back.toString());
    u.searchParams.set("login_error", code);
    return NextResponse.redirect(u, { status: 303 });
  };

  const rl = await rateLimit("authorize-password", clientIp(req), 15, 900);
  if (!rl.ok) return fail("rate");

  const email = (fields.email ?? "").trim();
  const password = fields.password ?? "";
  if (!email || !password) return fail("1");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse("server_error", { status: 500 });
  }

  const response = NextResponse.redirect(back, { status: 303 });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic: do not echo the provider message or the address.
    return fail("1");
  }
  return response;
}
