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

/**
 * localStorage guard prefix so the conversion fires at most once per *account*
 * (keyed on user id), and survives the OAuth / magic-link redirect + tab close —
 * unlike the previous sessionStorage guard, which could miss or re-fire.
 */
const SIGNUP_FIRED_KEY_PREFIX = 'rm_signup_conv_fired:';

/**
 * How recently an account must have been created to still count as a "sign-up"
 * worth reporting. Wide enough to cover the real gap between when an account row
 * is created and when the user actually returns via an email magic-link (which
 * can be many minutes — the old 2-minute delta silently dropped those), but
 * short enough that a returning user signing in days later does not re-fire.
 */
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

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
 * A freshly-created account: created_at within NEW_ACCOUNT_WINDOW_MS of now.
 *
 * Accounts are auto-created on first sign-in here, so created_at marks the sign-up.
 * We deliberately do NOT require created_at ≈ last_sign_in_at: for email magic-link
 * sign-ups the row is created when the link is requested and last_sign_in_at is set
 * when it's clicked, a gap that routinely exceeds a couple of minutes and used to
 * suppress the conversion entirely. Per-account dedupe (below) prevents re-firing,
 * so a generous window is safe.
 */
function isNewAccount(user: User): boolean {
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isNaN(created)) return false;
  return Date.now() - created < NEW_ACCOUNT_WINDOW_MS;
}

/** Per-account guard: has this browser already reported the sign-up for this user id? */
function signupAlreadyFired(userId: string): boolean {
  try {
    return localStorage.getItem(SIGNUP_FIRED_KEY_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

function markSignupFired(userId: string): void {
  try {
    localStorage.setItem(SIGNUP_FIRED_KEY_PREFIX + userId, '1');
  } catch {
    /* private mode / quota — at worst we rely on Google's count:One server dedupe */
  }
}

/**
 * Fire the Google Ads "Sign-up" conversion for a newly-created account.
 *
 * Safe to call on every auth-state change and on the OAuth / magic-link return:
 * it self-dedupes per account (localStorage, keyed on user id) and only fires for
 * recently-created accounts, so returning sign-ins and token refreshes are ignored.
 * Google's own count:One setting is the final backstop against duplicates.
 */
export function reportSignupConversion(user: User | null | undefined): void {
  if (!user) return;
  if (typeof window === 'undefined') return;
  if (!isNewAccount(user)) return;
  if (signupAlreadyFired(user.id)) return;

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

  // Mark only after we've actually handed the event to gtag, so a missing-gtag
  // early-return can still fire on a later call within the window.
  markSignupFired(user.id);
}
