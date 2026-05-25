'use client';

import { useEffect } from 'react';
import { captureUTMFromURL, getUTMData } from '@/lib/utm';

declare global {
  interface Window {
    /** Google tag (Ads / GA); loaded via GoogleAdsTag. */
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Runs once per page load to capture URL UTM params and mirror them into gtag
 * user_properties when available.
 */
export function UTMTracker() {
  useEffect(() => {
    captureUTMFromURL(window.location.search);
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
