/**
 * MCP-specific auth wrapper.
 *
 * Accepts API key from:
 *   - `Authorization: Bearer <key>` header (preferred, same as REST endpoints)
 *   - `X-API-Key: <key>` header (existing REST fallback)
 *   - `?api_key=<key>` query param (SSE GET fallback — `EventSource` can't set headers)
 *
 * Re-uses `extractApiKey` + `validateApiKey` from `lib/agent/api-keys.ts` —
 * no new DB surface, same hash/validate path as all other API routes.
 *
 * Logs only a truncated prefix of the key (first 15 chars, e.g.
 * `rm_agent_live_Xx`), never the full key.
 */

import { extractApiKey, validateApiKey, type ValidatedKey } from "@/lib/agent/api-keys";

export type McpAuthResult =
  | {
      ok: true;
      apiKey: string;
      userId: string;
      keyPrefix: string;
      validated: ValidatedKey;
    }
  | {
      ok: false;
      status: 401 | 500;
      error: string;
    };

function truncateKey(key: string): string {
  // rm_agent_live_XX… — first 15 chars are enough to grep logs without
  // exposing enough material to use the key.
  return key.slice(0, 15) + "…";
}

/** Extract the raw key from headers first, then `?api_key=` query param. */
export function extractApiKeyFromRequest(request: Request): string | null {
  const fromHeader = extractApiKey(request);
  if (fromHeader) return fromHeader;

  try {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("api_key");
    if (fromQuery) return fromQuery.trim();
  } catch {
    // ignore malformed URLs
  }
  return null;
}

/** Full auth flow: extract + validate + return result. */
export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
  const key = extractApiKeyFromRequest(request);
  if (!key) {
    return {
      ok: false,
      status: 401,
      error: "Missing API key. Provide `Authorization: Bearer <key>` or `?api_key=<key>`.",
    };
  }

  const validated = await validateApiKey(key);
  const keyPrefix = truncateKey(key);

  if (validated.serverError) {
    console.error(`[mcp-auth] server error validating ${keyPrefix}: ${validated.error}`);
    return { ok: false, status: 500, error: validated.error ?? "Authentication server error" };
  }
  if (!validated.valid) {
    console.warn(`[mcp-auth] rejected ${keyPrefix}: ${validated.error}`);
    return {
      ok: false,
      status: 401,
      error: validated.error ?? "Invalid API key",
    };
  }

  return {
    ok: true,
    apiKey: key,
    userId: validated.userId!,
    keyPrefix,
    validated,
  };
}
