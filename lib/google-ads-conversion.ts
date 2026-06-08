'use client';

/**
 * Google Ads conversion reporting for riskmodels.app.
 *
 * Phase 1 (live): fire a client-side "Sign-up" conversion the first time an account
 *   is created (first sign-in), with Enhanced Conversions (email) for better match
 *   rates. The base Google tag (AW-18161098219) is loaded site-wide by
 *   components/GoogleAdsTag.tsx.
 *
 * Phase 2 (planned): "first API key use" activation via offline conversion import.
 *   captureGclid() persists the Google click id at landing so a server job can later
 *   upload an offline conversion (tied to the GCLID) when a key is first used.
 *   See docs/GOOGLE_ADS_CONVERSIONS.md.
 */

import type { User } from '@supabase/supabase-js';

/** Sign-up conversion action — Google Ads → Goals → "Sign-up" (count: One, value: $1). */
const SIGNUP_SEND_TO = 'AW-18161098219/Qn__CI297LocEOu78dND';

/** sessionStorage guard so the conversion fires at most once per browser session. */
const SIGNUP_FIRED_KEY = 'rm_signup_conversion_fired';

/** localStorage key for the Google click id (phase-2 offline activation import). */
export const RM_GCLID_STORAGE_KEY = 'rm_gclid';

type GtagFn = (...args: unknown[]) => void;

function getGtag(): GtagFn | null {
  if (typeof window === 'undefined') return null;
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === 'function' ? g : null;
}

/**
 * Capture the Google click id (gclid / wbraid / gbraid) from the URL and persist it.
 * Cheap groundwork for phase-2 offline conversion import (first API key use).
 */
export function captureGclid(search?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const q = search ?? window.location.search;
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
    const gclid =
      params.get('gclid') || params.get('wbraid') || params.get('gbraid');
    if (gclid) {
      localStorage.setItem(
        RM_GCLID_STORAGE_KEY,
        JSON.stringify({ gclid, timestamp: new Date().toISOString() }),
      );
    }
  } catch {
    /* private mode / quota */
  }
}

export function getStoredGclid(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RM_GCLID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { gclid?: string };
    return parsed.gclid ?? null;
  } catch {
    return null;
  }
}

/**
 * A freshly-created account: created_at within ~2 min of last_sign_in_at (the first
 * sign-in == account creation here, since accounts are auto-created on sign-in).
 */
function isNewAccount(user: User): boolean {
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  const lastSignIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
  if (Number.isNaN(created)) return false;
  if (!Number.isNaN(lastSignIn)) {
    return Math.abs(lastSignIn - created) < 2 * 60 * 1000;
  }
  // Fallback when last_sign_in_at is unavailable: created within the last 5 minutes.
  return Date.now() - created < 5 * 60 * 1000;
}

/**
 * Fire the Google Ads "Sign-up" conversion for a newly-created account.
 *
 * Safe to call on every auth-state change: it self-dedupes (sessionStorage) and only
 * fires for new accounts, so returning sign-ins and token refreshes are ignored.
 */
export function reportSignupConversion(user: User | null | undefined): void {
  if (!user) return;
  if (typeof window === 'undefined') return;
  if (!isNewAccount(user)) return;

  try {
    if (sessionStorage.getItem(SIGNUP_FIRED_KEY)) return;
  } catch {
    /* ignore */
  }

  const gtag = getGtag();
  if (!gtag) return;

  // Enhanced Conversions: provide the unhashed email; the Google tag hashes it
  // client-side before sending. Requires Enhanced Conversions enabled on the
  // account + this conversion action (Google Ads → Goals → Settings).
  if (user.email) {
    gtag('set', 'user_data', { email: user.email });
  }

  gtag('event', 'conversion', {
    send_to: SIGNUP_SEND_TO,
    value: 1.0,
    currency: 'USD',
  });

  try {
    sessionStorage.setItem(SIGNUP_FIRED_KEY, '1');
  } catch {
    /* ignore */
  }
}
