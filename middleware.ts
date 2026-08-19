import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { openbbCors } from '@/app/openbb/_lib/cors';
import { checkDataGatewayRateLimit } from '@/lib/ratelimit/data-gateway-rate-limit';

export async function middleware(request: NextRequest) {
  // OpenBB Workspace adapter: API-key auth, not cookies. Answer CORS
  // preflight here so OPTIONS never waits on Supabase session refresh (a
  // timeout there looks like a CORS failure in pro.openbb.co / .dev).
  if (request.nextUrl.pathname.startsWith('/openbb')) {
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: openbbCors(request) });
    }
    return NextResponse.next({ request });
  }

  // Internal render route used by Playwright — skip Supabase session refresh.
  // Forward pathname as a request header so the root layout can detect this route.
  if (request.nextUrl.pathname.startsWith('/render-snapshot')) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-pathname', request.nextUrl.pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // EODHD Exhibit B(g) safeguard: the soft-auth /api/data/* gateway has no
  // per-key limiter (it does not use withBilling), so throttle it per-IP to
  // prevent systematic scraping / dataset reconstruction. Service-key
  // (first-party) callers are exempt; fails open if Upstash is unavailable.
  if (request.nextUrl.pathname.startsWith('/api/data/')) {
    const rl = await checkDataGatewayRateLimit(request.headers);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rl.retryAfterSec ?? 60),
            'X-RateLimit-Limit': String(rl.limit ?? ''),
          },
        },
      );
    }
  }

  // Supabase magic link falls back to site root when /auth/callback isn't in the allowlist.
  // Redirect /?code= to /get-key so the client component can exchange it (PKCE verifier is browser-side).
  const code = request.nextUrl.searchParams.get('code');
  if (code && request.nextUrl.pathname === '/') {
    const dest = new URL('/get-key', request.url);
    dest.searchParams.set('code', code);
    return NextResponse.redirect(dest);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — do not remove
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
