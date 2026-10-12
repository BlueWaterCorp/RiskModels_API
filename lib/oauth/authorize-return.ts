/**
 * Helpers for returning a user to the OAuth authorize page after sign-in.
 *
 * Both the "not signed in" bounce and the consent screen's "Use a different
 * account" action send the user to `/get-key?next=/oauth/authorize?...`. The
 * return path is always rebuilt on the fixed `/oauth/authorize` path, so a
 * caller-supplied query string can never turn it into an open redirect.
 */

export const AUTHORIZE_PATH = "/oauth/authorize";
export const SIGN_IN_PATH = "/get-key";

/** The parameters the authorize flow carries through a sign-in round trip. */
export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

/** `/oauth/authorize?<params>` keeping every known authorize parameter that is set. */
export function authorizeReturnPath(source: ParamSource): string {
  const get = (k: string) =>
    source instanceof URLSearchParams ? source.get(k) : first(source[k]);
  const qs = new URLSearchParams();
  for (const k of AUTHORIZE_PARAMS) {
    const v = get(k);
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${AUTHORIZE_PATH}?${s}` : AUTHORIZE_PATH;
}

/** `/get-key?next=<authorize return path>` — the sign-in step of the authorize flow. */
export function signInPathFor(source: ParamSource): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(authorizeReturnPath(source))}`;
}

/** True when a get-key `next` value points back into the OAuth authorize flow. */
export function isAuthorizeReturn(next: string | null | undefined): boolean {
  return !!next && (next === AUTHORIZE_PATH || next.startsWith(`${AUTHORIZE_PATH}?`));
}
