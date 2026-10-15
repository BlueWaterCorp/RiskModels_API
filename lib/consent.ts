/**
 * Cookie consent for visitors in the EEA, UK and Switzerland.
 *
 * Google tags start with consent denied in those regions (Consent Mode v2
 * default in components/GoogleTagManager.tsx, which Google applies by visitor
 * location). PostHog starts opted out for visitors whose browser time zone is
 * European. The banner (components/ConsentBanner.tsx) records the choice in
 * localStorage; everyone else is unaffected.
 */
import posthog from 'posthog-js';

import { CONSENT_KEY } from '@/lib/consent-config';
export { CONSENT_KEY, CONSENT_REGIONS } from '@/lib/consent-config';
export type ConsentChoice = 'granted' | 'denied';

const EUROPEAN_ATLANTIC_ZONES = ['Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Faroe'];

/** Browser-side guess at whether the visitor is in a consent region. */
export function inConsentRegion(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz.startsWith('Europe/') || EUROPEAN_ATLANTIC_ZONES.includes(tz);
  } catch {
    return false;
  }
}

export function getConsent(): ConsentChoice | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

type GtagFn = (...args: unknown[]) => void;

export function setConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* storage blocked: the choice holds for this page view only */
  }
  const state = choice === 'granted' ? 'granted' : 'denied';
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  gtag?.('consent', 'update', {
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
    analytics_storage: state,
  });
  try {
    if (choice === 'granted') posthog.opt_in_capturing();
    else posthog.opt_out_capturing();
  } catch {
    /* PostHog not initialised (no key configured) */
  }
}
