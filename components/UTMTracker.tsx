'use client';

import { useEffect } from 'react';
import { captureGclid } from '@/lib/google-ads-conversion';
import { captureUTMFromURL, getUTMData } from '@/lib/utm';

declare global {
  interface Window {
    /** Google tag (Ads / GA); loaded via GoogleAdsTag. */
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Runs once per page load to capture URL UTM + Google click id (gclid/wbraid/gbraid)
 * into localStorage, and mirror UTM into gtag user_properties when available.
 *
 * gclid must be captured site-wide (not only on /get-key): Ads final URLs often
 * land on `/` or docs; navigating to /get-key drops the query string and would
 * otherwise leave signup_attribution.gclid empty forever (45d+ zero paid observed
 * 2026-07-23 while Ads was spending).
 */
export function UTMTracker() {
  useEffect(() => {
    const search = window.location.search;
    captureUTMFromURL(search);
    captureGclid(search);
    const utm = getUTMData();
    if (!utm || typeof window.gtag !== 'function') return;

    window.gtag('set', 'user_properties', {
      ...(utm.utm_source != null && { utm_source: utm.utm_source }),
      ...(utm.utm_medium != null && { utm_medium: utm.utm_medium }),
      ...(utm.utm_campaign != null && { utm_campaign: utm.utm_campaign }),
      ...(utm.utm_content != null && { utm_content: utm.utm_content }),
    });
  }, []);

  return null;
}
