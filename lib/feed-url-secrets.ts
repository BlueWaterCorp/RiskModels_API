/**
 * Secrets in feed links (/security-master-feed/confirm, /unsubscribe, /delivery,
 * /delivery/confirm) must not reach analytics.
 *
 * 1. FEED_SECRET_STASH_SCRIPT runs inline at the top of <head> (app/layout.tsx),
 *    before Google Tag Manager, the Google tag and PostHog load. On a feed page it
 *    copies the `token` (and any `inbox`) query values to an in-memory object and,
 *    when the browser allows it, to sessionStorage, then removes them from the
 *    address bar with history.replaceState, so the URL every tag reads afterwards
 *    carries no secret. A browser that blocks storage still works from memory.
 * 2. The feed pages read the values back with readFeedSecret().
 * 3. sanitizeFeedSecrets() is PostHog's before_send: it strips those parameters
 *    from any property that still quotes a feed URL (current URL, referrer,
 *    initial URL), in case an event is captured before the stash ran.
 */

export const FEED_PATH_PREFIX = "/security-master-feed";
export const FEED_SECRET_PARAMS = ["token", "inbox"] as const;
const STORAGE_PREFIX = "rm_feed_secret:";

/** In-memory copy, for browsers that block sessionStorage (the page still works; nothing persists). */
const MEMORY_KEY = "__rmFeedSecrets";

export const FEED_SECRET_STASH_SCRIPT = `(function(){try{var l=window.location;if(l.pathname.indexOf(${JSON.stringify(
  FEED_PATH_PREFIX,
)})!==0)return;var q=new URLSearchParams(l.search),n=${JSON.stringify(FEED_SECRET_PARAMS)},c=false,m=window[${JSON.stringify(
  MEMORY_KEY,
)}]=window[${JSON.stringify(MEMORY_KEY)}]||{};for(var i=0;i<n.length;i++){var v=q.get(n[i]);if(v!==null){var k=${JSON.stringify(
  STORAGE_PREFIX,
)}+l.pathname+":"+n[i];m[k]=v;try{sessionStorage.setItem(k,v)}catch(e){}q.delete(n[i]);c=true}}if(c){var s=q.toString();history.replaceState(history.state,"",l.pathname+(s?"?"+s:"")+l.hash)}}catch(e){}})();`;

/** The stashed value for this page: sessionStorage, else the in-memory copy, else the URL (no script ran). */
export function readFeedSecret(name: (typeof FEED_SECRET_PARAMS)[number]): string | null {
  if (typeof window === "undefined") return null;
  const key = `${STORAGE_PREFIX}${window.location.pathname}:${name}`;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored) return stored;
  } catch {
    // storage blocked: fall through to the in-memory copy
  }
  const memory = (window as unknown as Record<string, Record<string, string> | undefined>)[MEMORY_KEY];
  if (memory?.[key]) return memory[key];
  return new URLSearchParams(window.location.search).get(name);
}

/** Any feed path followed by a query string, inside a longer value. */
const FEED_QUERY_RE = new RegExp(`(${FEED_PATH_PREFIX}[^?#\\s"']*)\\?([^#\\s"']*)`, "g");

/** A string with the feed secret parameters removed from every feed URL in it; other strings unchanged. */
export function stripFeedSecrets(value: string): string {
  if (!value.includes(FEED_PATH_PREFIX)) return value;
  return value.replace(FEED_QUERY_RE, (_m, path: string, qs: string) => {
    const params = new URLSearchParams(qs);
    for (const name of FEED_SECRET_PARAMS) params.delete(name);
    const rest = params.toString();
    return rest ? `${path}?${rest}` : path;
  });
}

interface CaptureLike {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

function cleanProps(obj: Record<string, unknown> | undefined) {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) if (typeof v === "string") obj[k] = stripFeedSecrets(v);
}

/** PostHog before_send: strip feed secrets from every string property. */
export function sanitizeFeedSecrets<T extends CaptureLike | null>(event: T): T {
  if (!event) return event;
  cleanProps(event.properties);
  cleanProps(event.$set);
  cleanProps(event.$set_once);
  return event;
}
