/**
 * Upstream helpers for the OpenBB adapter.
 *
 * The adapter is a pure translation layer: it never reads the engine directly,
 * it calls the same public REST API any external consumer would, with the
 * OpenBB user's own key. That keeps billing, rate limits, and entitlements
 * identical to a direct API consumer — the adapter has no privileged access.
 */

/** Public API base, e.g. https://riskmodels.app/api. No trailing slash. */
export function upstreamBase(): string {
  return (
    process.env.NEXT_PUBLIC_RISKMODELS_API_URL || "https://riskmodels.app/api"
  ).replace(/\/+$/, "");
}

/**
 * The OpenBB user pastes their `rm_agent_live_*` key into the Workspace
 * "Add data" auth UI as an `X-API-KEY` header. We forward it as a standard
 * Bearer token. Returns null when absent so callers can 401 cleanly.
 */
export function bearerFromRequest(req: Request): string | null {
  const raw =
    req.headers.get("x-api-key") || req.headers.get("authorization") || "";
  if (!raw) return null;
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
}

/** GET an upstream path with the forwarded key. Returns the parsed JSON + status. */
export async function upstreamGet(
  path: string,
  key: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${upstreamBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    // The adapter runs server-side on Vercel; no caching so entitlements/billing
    // are evaluated per request.
    cache: "no-store",
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = { error: "upstream returned non-JSON", status: res.status };
  }
  return { status: res.status, body };
}

/**
 * GET an upstream binary asset (e.g. a snapshot PDF) with the forwarded key.
 * Returns the raw bytes on success, or the parsed JSON error body on failure
 * (the API returns JSON errors even on the binary routes).
 */
export async function upstreamGetBytes(
  path: string,
  key: string,
): Promise<{
  status: number;
  contentType: string | null;
  bytes: ArrayBuffer | null;
  error: unknown;
}> {
  const url = `${upstreamBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type");
  if (res.status < 200 || res.status >= 300) {
    let error: unknown = { error: `Upstream returned ${res.status}` };
    try {
      error = await res.json();
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    return { status: res.status, contentType, bytes: null, error };
  }

  const bytes = await res.arrayBuffer();
  return { status: res.status, contentType, bytes, error: null };
}
