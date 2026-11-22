import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { ensureSignupSite } from '@/lib/auth/signup-site';
import {
  ensureAccountWithAttribution,
  parseAttributionTouch,
  touchIsEmpty,
} from '@/lib/agent/account-bootstrap';
import { LANDING_PATH_PARAM } from '@/lib/utm';

export const dynamic = 'force-dynamic';

const SIGN_IN_PATH = '/get-key';
/** Attribution parameters the sign-in page appends to the callback URL. */
const CARRIED_PARAMS = [
  'gclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  LANDING_PATH_PARAM,
  'ref',
] as const;

/**
 * Why sign-in did not complete, for the message on /get-key:
 *   expired      the link was already used or is too old (Supabase otp_expired)
 *   other_device no PKCE verifier cookie: the link was opened in a browser
 *                other than the one that asked for it
 *   failed       anything else
 */
type FailReason = 'expired' | 'other_device' | 'failed';

function failRedirect(origin: string, reason: FailReason, next: string): NextResponse {
  const url = new URL(SIGN_IN_PATH, origin);
  url.searchParams.set('error', 'auth');
  url.searchParams.set('reason', reason);
  // Keep the destination so a retry continues the same flow.
  if (next !== SIGN_IN_PATH) url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

/**
 * OAuth + magic-link callback. Must attach Supabase `sb-*` cookies to the redirect response
 * (see sibling Risk_Models `auth/callback/route.ts`); otherwise the session is not stored in the browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Same-origin relative paths only; anything else falls back to /get-key.
  const nextPath = safeRedirectPath(searchParams.get('next'), SIGN_IN_PATH);
  const nextIsSignInPage = nextPath === SIGN_IN_PATH || nextPath.startsWith(`${SIGN_IN_PATH}?`);
  // For the message only; the destination on failure is always /get-key.
  const failNext = nextIsSignInPage ? SIGN_IN_PATH : nextPath;

  if (!code) {
    const expired = searchParams.get('error_code') === 'otp_expired';
    return failRedirect(origin, expired ? 'expired' : 'failed', failNext);
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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const cookieNames = cookieStore.getAll().map((c) => c.name);
    // Cookie NAMES only (never values): tells a missing PKCE verifier cookie
    // apart from one present under another name/domain (2026-09-29 sign-in failures).
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, {
      cookieNames,
      host: request.headers.get('host'),
      referer: (request.headers.get('referer') || '').slice(0, 80),
    });
    const hasVerifier = cookieNames.some((n) => n.includes('code-verifier'));
    return failRedirect(origin, hasVerifier ? 'expired' : 'other_device', failNext);
  }

  const user = data?.user ?? data?.session?.user ?? null;
  const dest = new URL(nextPath, origin);

  // Attribution carried on the callback URL (the browser that opens a magic
  // link may have empty storage).
  const carried: Record<string, string> = {};
  for (const k of CARRIED_PARAMS) {
    const v = searchParams.get(k);
    if (v) carried[k] = v.slice(0, 512);
  }

  if (nextIsSignInPage) {
    // /get-key re-captures these client-side and posts them with its one
    // bootstrap call. Never replace a value already on the destination.
    for (const [k, v] of Object.entries(carried)) {
      if (!dest.searchParams.has(k)) dest.searchParams.set(k, v);
    }
  }

  if (user) {
    try {
      const admin = createAdminClient();
      // OAuth sign-ins carry no options.data, so mark the site here (only if unset).
      await ensureSignupSite(admin, user);
      if (!nextIsSignInPage) {
        // The user is not going to /get-key (e.g. the OAuth connector flow), so
        // nothing client-side will post attribution: write it now, with the
        // account, in the same single step /get-key uses.
        const utmSource = carried.utm_source ?? null;
        const utmMedium = carried.utm_medium ?? null;
        const utmCampaign = carried.utm_campaign ?? null;
        const touch = parseAttributionTouch({
          gclid: carried.gclid,
          landing_path: carried[LANDING_PATH_PARAM],
          utm:
            utmSource || utmMedium || utmCampaign
              ? {
                  utm_source: utmSource,
                  utm_medium: utmMedium,
                  utm_campaign: utmCampaign,
                  utm_content: carried.utm_content ?? null,
                  timestamp: new Date().toISOString(),
                  referrer: null,
                  landing_path: carried[LANDING_PATH_PARAM] ?? '/',
                }
              : undefined,
        });
        if (!touchIsEmpty(touch)) await ensureAccountWithAttribution(admin, user, touch);
      }
    } catch (e) {
      // Sign-in already succeeded; bookkeeping must not undo it.
      console.error('[auth/callback] post-sign-in bookkeeping failed:', e instanceof Error ? e.message : e);
    }
  }

  const redirectResponse = NextResponse.redirect(dest);

  cookiesToSet.forEach(({ name, value, options }) => {
    if (name.startsWith('sb-')) {
      redirectResponse.cookies.set(name, value, options);
    }
  });

  return redirectResponse;
}
