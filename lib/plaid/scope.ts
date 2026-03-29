import { extractApiKey, validateApiKey } from "@/lib/agent/api-keys";
import type { NextRequest } from "next/server";

/**
 * When scopes are empty or missing, allow full access (legacy keys).
 * Otherwise require `plaid:holdings` or `*`.
 */
export function canAccessPlaidHoldings(scopes: string[] | null | undefined): boolean {
  if (!scopes || scopes.length === 0) return true;
  if (scopes.includes("*")) return true;
  return scopes.includes("plaid:holdings");
}

export async function resolveApiKeyScopes(request: NextRequest): Promise<string[] | null> {
  const key = extractApiKey(request);
  if (!key) return null;
  const v = await validateApiKey(key);
  if (!v.valid) return null;
  const s = v.scopes;
  if (s == null) return null;
  return Array.isArray(s) ? (s as string[]) : null;
}
