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

/** Parse current URL query and persist UTM fields when campaign params are present. */
export function captureUTMFromURL(search: string): void {
  if (typeof window === 'undefined') return;

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

  const ref = typeof document !== 'undefined' && document.referrer ? document.referrer : '';
  const referrer =
    ref.length > MAX_REFERRER_LEN ? ref.slice(0, MAX_REFERRER_LEN) : ref || null;

  let landing_path =
    typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
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
