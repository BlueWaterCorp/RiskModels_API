type CacheEntry = { token: string; expiresAtMono: number };

const skewSeconds = 60;
const cache = new Map<string, CacheEntry>();

function cacheKey(apiRoot: string, clientId: string, scope: string): string {
  return `${apiRoot}\0${clientId}\0${scope}`;
}

export function invalidateOAuthToken(apiRoot: string, clientId: string, scope: string): void {
  cache.delete(cacheKey(apiRoot, clientId, scope));
}

export async function fetchOAuthAccessToken(
  apiRoot: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<string> {
  const key = cacheKey(apiRoot, clientId, scope);
  const now = performance.now();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAtMono - skewSeconds * 1000) {
    return hit.token;
  }

  const url = `${apiRoot.replace(/\/$/, "")}/auth/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });
  const text = await res.text();
  let data: { access_token?: string; expires_in?: number; error?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`OAuth token: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.error ?? `OAuth token: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!data.access_token) {
    throw new Error("OAuth token response missing access_token");
  }
  const expiresIn = Math.max(30, Number(data.expires_in ?? 900));
  cache.set(key, {
    token: data.access_token,
    expiresAtMono: now + expiresIn * 1000,
  });
  return data.access_token;
}
