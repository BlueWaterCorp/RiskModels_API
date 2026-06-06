/**
 * EODHD data-license policy — Exhibit B of the Data Services Agreement.
 * (RiskModels_IP/docs/licensing/EODHD_Agreement_v3_Complete_DocuSign.pdf)
 *
 * Exhibit B in brief:
 *   B(c)/(d) — Derived Data (betas, returns, hedge ratios, factor exposures,
 *     volatility, attribution, …) may be redistributed freely via our own API.
 *     The entire V3 metric dictionary EXCEPT the two raw fields below is Derived.
 *   B(e)     — The raw fields "end-of-day close price" and "market capitalization"
 *     may be displayed ONLY (1) within authenticated environments, (2) on a
 *     per-symbol, per-request basis, ancillary to Derived outputs, and (4) behind
 *     anti-bulk safeguards. B(f) confirms per-symbol/per-call delivery of these
 *     fields is NOT "raw or bulk form" redistribution.
 *   B(b)/(i) — No raw/bulk resale; no fake-derived (rounding, rename, ±constant).
 *
 * Encoding for the /api/data/security-history surface (the internal data gateway):
 *   - The raw fields require the gateway service key (the authenticated, first-party
 *     environment). Unauthenticated callers get derived data only. External
 *     authenticated users reach raw close/mktcap through the billed endpoints
 *     (/api/metrics/:ticker scalar, /api/ticker-returns per-symbol).
 *   - Raw fields are NEVER served in a multi-symbol (bulk) batch request, because
 *     B(e)/(f) permit raw fields only "per-symbol, per-call".
 */

import { type NextRequest } from "next/server";

/** Raw EODHD fields restricted by Exhibit B(e). Everything else is Derived Data. */
export const RAW_RESTRICTED_KEYS = new Set<string>(["price_close", "market_cap"]);

/** True if any requested metric key is a raw, license-restricted field. */
export function requestsRawRestricted(keys: readonly string[]): boolean {
  return keys.some((k) => RAW_RESTRICTED_KEYS.has(k.trim()));
}

/**
 * True when the request carries the valid gateway service key — i.e. an
 * authenticated, first-party environment per Exhibit B(e) condition (1).
 *
 * When no service key is configured (local/dev), treat as authenticated so the
 * dev experience is unchanged. Production always sets RISKMODELS_API_SERVICE_KEY.
 * This mirrors the pass-through behavior of `verifyGatewayAuth` when `!key`.
 */
export function isGatewayAuthenticated(request: NextRequest): boolean {
  const key = process.env.RISKMODELS_API_SERVICE_KEY;
  if (!key) return true;
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === key;
}

/**
 * Drop raw, license-restricted columns from a wide `security_history_latest`
 * row. Used when serving the wide row to an unauthenticated caller, or in any
 * bulk (multi-symbol) context where raw fields are not permitted at all.
 */
export function stripRawRestricted<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const k of RAW_RESTRICTED_KEYS) delete (out as Record<string, unknown>)[k];
  return out;
}
