/**
 * Scope check for API keys on billed capabilities (BWM-19).
 *
 * `agent_api_keys.scopes` / `user_generated_api_keys.scopes` were stored but
 * never enforced. The rule here keeps every key issued so far working except
 * keys that name specific capabilities:
 *  - no scopes, `*` or `read` (user keys and OAuth tokens) → every capability;
 *  - a list that names capability ids → only those capabilities;
 *  - entries that are not capability ids (`rate:N`, `plaid:holdings`,
 *    `mcp:read`) do not narrow access by themselves.
 */

import { getCapability } from "./capabilities";

const GRANTS_ALL = new Set(["*", "read"]);

export function keyAllowsCapability(
  scopes: string[] | null | undefined,
  capabilityId: string,
  isCapability: (id: string) => boolean = (id) => getCapability(id) !== undefined,
): boolean {
  if (!scopes || scopes.length === 0) return true;
  if (scopes.some((s) => GRANTS_ALL.has(s))) return true;
  const named = scopes.filter(isCapability);
  if (named.length === 0) return true;
  return named.includes(capabilityId);
}
