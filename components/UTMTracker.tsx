'use client';

import { useEffect } from 'react';
import { captureGclid, getStoredGclid } from '@/lib/google-ads-conversion';
import { captureUTMFromURL, getUTMData } from '@/lib/utm';
import { trackEvent } from '@/lib/posthog-client';

declare global {
  interface Window {
    /** Google tag (Ads / GA); loaded via GoogleAdsTag. */
    gtag?: (...args: unknown[]) => void;
  }
}

const ATTRIBUTION_SENT_KEY = 'rm_attribution_posted';

/**
 * Runs once per page load to capture URL UTM + Google click id (gclid/wbraid/gbraid)
 * into localStorage, and mirror UTM into gtag user_properties when available.
 *
 * gclid must be captured site-wide (not only on /get-key): Ads final URLs often
 * land on `/` or docs; navigating to /get-key drops the query string and would
 * otherwise leave signup_attribution.gclid empty forever (45d+ zero paid observed
 * 2026-07-23 while Ads was spending).
 *
 * After capture, post first-touch attribution if a session cookie exists so
 * Ads sign-ins are recorded before key mint.
 */
export function UTMTracker() {
  useEffect(() => {
    const search = window.location.search;
    captureUTMFromURL(search);
    captureGclid(search);
    const utm = getUTMData();
    const gclid = getStoredGclid();
    trackEvent('funnel_page', {
      path: window.location.pathname,
      has_gclid: Boolean(gclid),
      utm_source: utm?.utm_source ?? null,
      utm_medium: utm?.utm_medium ?? null,
      utm_campaign: utm?.utm_campaign ?? null,
      site: 'riskmodels.app',
    });
    if (typeof window.gtag === 'function' && utm) {
      window.gtag('set', 'user_properties', {
        ...(utm.utm_source != null && { utm_source: utm.utm_source }),
        ...(utm.utm_medium != null && { utm_medium: utm.utm_medium }),
        ...(utm.utm_campaign != null && { utm_campaign: utm.utm_campaign }),
        ...(utm.utm_content != null && { utm_content: utm.utm_content }),
      });
    }
    try {
      if (sessionStorage.getItem(ATTRIBUTION_SENT_KEY) === '1') return;
    } catch {
      /* private mode */
    }
    void fetch('/api/agent-accounts/attribution', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gclid,
        utm,
        landing_path: window.location.pathname,
      }),
    })
      .then((res) => {
        if (res.ok) {
          try {
            sessionStorage.setItem(ATTRIBUTION_SENT_KEY, '1');
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        /* offline / adblock */
      });
  }, []);

  return null;
}
