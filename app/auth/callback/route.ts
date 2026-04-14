import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * OAuth + magic-link callback. Must attach Supabase `sb-*` cookies to the redirect response
 * (see sibling Risk_Models `auth/callback/route.ts`); otherwise the session is not stored in the browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextRaw = searchParams.get('next') ?? '/get-key';
  const nextPath = nextRaw.startsWith('/') ? nextRaw : `/${nextRaw}`;

  if (!code) {
    return NextResponse.redirect(new URL(`/get-key?error=auth`, origin));
  }

  const cookieStore = await cookies();
  const cookiesToSet: Array<{
    name: string;
    value: string;
    options?: Parameters<typeof cookieStore.set>[2];
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(incoming) {
          incoming.forEach(({ name, value, options }) => {
            cookiesToSet.push({ name, value, options });
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Some Next runtimes restrict cookie writes here; redirect still applies sb-* below.
            }
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message);
    return NextResponse.redirect(new URL(`/get-key?error=auth`, origin));
  }

  const redirectResponse = NextResponse.redirect(new URL(nextPath, origin));

  cookiesToSet.forEach(({ name, value, options }) => {
    if (name.startsWith('sb-')) {
      redirectResponse.cookies.set(name, value, options);
    }
  });

  return redirectResponse;
}
