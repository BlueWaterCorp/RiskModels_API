/**
 * UTM capture for marketing attribution (riskmodels.app).
 * Client: localStorage persistence. Server may validate via parseValidatedSignupUtm.
 */

/** Distinct from `rm_referral_code`; longer-lived attribution than session referral. */
export const RM_UTM_STORAGE_KEY = 'rm_utm_data';

const MAX_UTM_FIELD_LEN = 256;
const MAX_REFERRER_LEN = 2048;
const MAX_LANDING_PATH_LEN = 512;

export type UTMData = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  timestamp: string;
  referrer: string | null;
  landing_path: string;
};

function sanitizeUtmSegment(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_UTM_FIELD_LEN ? trimmed.slice(0, MAX_UTM_FIELD_LEN) : trimmed;
}

function isUtmDataLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates a client-supplied UTM blob for POST /api/agent-keys.
 * Returns null if malformed or absent.
 */
export function parseValidatedSignupUtm(raw: unknown): UTMData | null {
  if (!isUtmDataLike(raw)) return null;

  const utm_source = sanitizeUtmSegment(
    typeof raw.utm_source === 'string' ? raw.utm_source : null,
  );
  const utm_medium = sanitizeUtmSegment(
    typeof raw.utm_medium === 'string' ? raw.utm_medium : null,
  );
  const utm_campaign = sanitizeUtmSegment(
    typeof raw.utm_campaign === 'string' ? raw.utm_campaign : null,
  );
  const utm_content = sanitizeUtmSegment(
    typeof raw.utm_content === 'string' ? raw.utm_content : null,
  );

  const tsRaw = typeof raw.timestamp === 'string' ? raw.timestamp.trim() : '';
  if (!tsRaw) return null;
  if (Number.isNaN(Date.parse(tsRaw))) return null;

  let landing_path =
    typeof raw.landing_path === 'string' ? raw.landing_path.trim() : '';
  if (!landing_path.startsWith('/') || landing_path.length > MAX_LANDING_PATH_LEN) {
    return null;
  }

  let referrer: string | null = null;
  if (typeof raw.referrer === 'string' && raw.referrer.trim()) {
    referrer =
      raw.referrer.length > MAX_REFERRER_LEN
        ? raw.referrer.slice(0, MAX_REFERRER_LEN)
        : raw.referrer;
  } else if (raw.referrer === null) {
    referrer = null;
  }

  if (!utm_source && !utm_medium && !utm_campaign) return null;

  return {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    timestamp: tsRaw,
    referrer,
    landing_path,
  };
}

/**
 * Query parameter that carries the first landing path through the sign-in
 * round trip (a magic link can open in a browser context with empty storage).
 */
export const LANDING_PATH_PARAM = 'lp';

/** localStorage key for the first landing of this browser, UTM or not. */
export const RM_FIRST_TOUCH_STORAGE_KEY = 'rm_first_touch';

export type FirstTouch = {
  landing_path: string;
  referrer: string | null;
  timestamp: string;
};

function validLandingPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (path.length > MAX_LANDING_PATH_LEN) return null;
  return path;
}

/** Referrer from another site only; same-site navigation is not a referrer. */
function externalReferrer(): string | null {
  if (typeof document === 'undefined' || !document.referrer) return null;
  try {
    if (new URL(document.referrer).host === window.location.host) return null;
  } catch {
    return null;
  }
  return document.referrer.length > MAX_REFERRER_LEN
    ? document.referrer.slice(0, MAX_REFERRER_LEN)
    : document.referrer;
}

function landingPathParam(query: string): string | null {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  return validLandingPath(params.get(LANDING_PATH_PARAM));
}

export function getFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RM_FIRST_TOUCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const landing_path = validLandingPath(parsed.landing_path);
    if (!landing_path) return null;
    return {
      landing_path,
      referrer: typeof parsed.referrer === 'string' && parsed.referrer ? parsed.referrer : null,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : '',
    };
  } catch {
    return null;
  }
}

/**
 * Record the first landing (path + external referrer) once per browser. Later
 * page views never replace it. On a return from sign-in the `lp` parameter
 * names the original landing path, and the referrer (the identity provider or
 * a mail client) is not recorded.
 */
export function captureFirstTouch(search?: string): void {
  if (typeof window === 'undefined') return;
  if (getFirstTouch()) return;
  const carried = landingPathParam(search ?? window.location.search);
  const touch: FirstTouch = {
    landing_path: carried ?? validLandingPath(window.location.pathname) ?? '/',
    referrer: carried ? null : externalReferrer(),
    timestamp: new Date().toISOString(),
  };
  try {
    localStorage.setItem(RM_FIRST_TOUCH_STORAGE_KEY, JSON.stringify(touch));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Parse current URL query and persist UTM fields when campaign params are
 * present. First touch wins: a stored record is never replaced by a later
 * visit (it is cleared after the first key is issued).
 */
export function captureUTMFromURL(search: string): void {
  if (typeof window === 'undefined') return;
  if (getUTMData()) return;

  let query = search;
  if (!query || query === '?') {
    query = window.location.search;
  }

  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const utm_source = sanitizeUtmSegment(params.get('utm_source'));
  const utm_medium = sanitizeUtmSegment(params.get('utm_medium'));
  const utm_campaign = sanitizeUtmSegment(params.get('utm_campaign'));
  const utm_content = sanitizeUtmSegment(params.get('utm_content'));

  if (!utm_source && !utm_medium && !utm_campaign) return;

  // Returning from sign-in: `lp` is the original landing path and the current
  // referrer is the identity provider or a mail client, not the source.
  const carried = landingPathParam(query);
  const ref = typeof document !== 'undefined' && document.referrer ? document.referrer : '';
  const referrer = carried
    ? null
    : ref.length > MAX_REFERRER_LEN ? ref.slice(0, MAX_REFERRER_LEN) : ref || null;

  let landing_path =
    carried ?? (typeof window !== 'undefined' ? window.location.pathname || '/' : '/');
  if (landing_path.length > MAX_LANDING_PATH_LEN) {
    landing_path = landing_path.slice(0, MAX_LANDING_PATH_LEN);
  }

  const utmData: UTMData = {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    timestamp: new Date().toISOString(),
    referrer,
    landing_path,
  };

  try {
    localStorage.setItem(RM_UTM_STORAGE_KEY, JSON.stringify(utmData));
  } catch {
    /* quota / private mode */
  }
}

export function getUTMData(): UTMData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RM_UTM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parseValidatedSignupUtm(parsed);
  } catch {
    return null;
  }
}

export function clearUTMData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RM_UTM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Max length for a Google click id (gclid/wbraid/gbraid are short URL-safe tokens). */
const MAX_GCLID_LEN = 512;

/**
 * Validate a client-supplied Google click id (gclid / wbraid / gbraid).
 * These are URL-safe tokens; reject anything with unexpected characters or length.
 * Returns null if absent or malformed. Used server-side for `POST /api/agent-keys`.
 */
export function sanitizeGclid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_GCLID_LEN) return null;
  // gclid/wbraid/gbraid use [A-Za-z0-9] plus URL-safe punctuation (_ - . and rarely =).
  if (!/^[A-Za-z0-9._\-=]+$/.test(trimmed)) return null;
  return trimmed;
}
