/**
 * Data-license gates. TWO independent gates plus a global mode:
 *
 *   GATE 1 (EODHD, field-level)  — raw close/mktcap, Exhibit B conditions.
 *   GATE 2 (CRSP, symbol-level)  — derived-only symbols, unconditional.
 *   DATA_LICENSE_MODE=license_free — escalates Gate 1 to unconditional so the
 *     whole API serves derived IP only (no vendor-licensed raw data at all).
 *
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

/* ------------------------------------------------------------------------- *
 * GATE 1 — EODHD (field-level, Exhibit B).
 *
 * In "standard" mode raw close/mktcap serve in authenticated per-symbol
 * contexts as Exhibit B(e)/(f) permit. In "license_free" mode the gate is
 * unconditional: raw EODHD fields are withheld from every caller, so the
 * entire API surface is derived IP with no vendor-licensed raw data.
 * ------------------------------------------------------------------------- */

/** Raw EODHD fields restricted by Exhibit B(e). Everything else is Derived Data. */
export const RAW_RESTRICTED_KEYS = new Set<string>(["price_close", "market_cap"]);

export type DataLicenseMode = "standard" | "license_free";

/** DATA_LICENSE_MODE env: "license_free" withholds ALL vendor raw fields
 *  unconditionally (derived-only API). Anything else = "standard". */
export function getDataLicenseMode(): DataLicenseMode {
  return process.env.DATA_LICENSE_MODE === "license_free"
    ? "license_free"
    : "standard";
}

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
 * GATE 1 decision: may raw EODHD fields (close/mktcap) be served on THIS
 * request? Standard mode: yes when gateway-authenticated (Exhibit B(e)
 * condition 1). License-free mode: never, for anyone — use this instead of
 * isGatewayAuthenticated at every raw-field call site so the mode flip
 * covers the whole surface.
 */
export function rawEodhdPermitted(request: NextRequest): boolean {
  if (getDataLicenseMode() === "license_free") return false;
  return isGatewayAuthenticated(request);
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

/**
 * Recursively drop raw, license-restricted fields from an arbitrary value.
 *
 * The chat surface returns nested tool results — raw fields sit under
 * `metrics.price_close` on one tool and across a `data[].price_close` series on
 * another — so a shallow strip is not enough. Used to serve the unauthenticated
 * landing demo, where Exhibit B(e) condition (1) is not met for any raw field.
 */
export function stripRawRestrictedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripRawRestrictedDeep(v)) as unknown as T;
  }
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_RESTRICTED_KEYS.has(k)) continue;
    out[k] = stripRawRestrictedDeep(v);
  }
  return out as T;
}

/* ------------------------------------------------------------------------- *
 * GATE 2 — CRSP-sourced symbols (symbol-level, unconditional in BOTH modes).
 *
 * Delisted-survivorship recovery seeds some price histories from CRSP (via
 * WRDS). Unlike the EODHD Exhibit-B field gate above — which permits raw
 * close/mktcap in authenticated, per-symbol contexts — the CRSP posture is
 * derived-only, period: raw SERIES fields (daily returns, close, market cap)
 * for these bw_sym_ids are never served, to any caller, in any format.
 * Derived outputs (L*, decompositions, attribution, hedges, rankings) are
 * unrestricted.
 *
 * The symbol list is a generated artifact (lib/restricted-source-symbols.json,
 * built by ERM3 gen_restricted_source_symbols.py from the CRSP seed CSVs).
 * Match on the RESOLVED canonical bw_sym_id, never on the ticker string.
 * ------------------------------------------------------------------------- */

import restrictedSourceConfig from "./restricted-source-symbols.json";

/** bw_sym_ids whose price history is CRSP-sourced (derived-only). */
export const RESTRICTED_SOURCE_SYMBOLS: ReadonlySet<string> = new Set(
  restrictedSourceConfig.symbols,
);

/**
 * Raw per-symbol SERIES fields blocked for restricted-source symbols. A
 * superset of RAW_RESTRICTED_KEYS: daily gross returns reconstruct the CRSP
 * price path (a cumulative product is "fake-derived", cf. Exhibit B(i)), so
 * they are raw here even though they are Derived Data under the EODHD terms.
 */
export const RAW_SERIES_KEYS = new Set<string>([
  "returns_gross",
  "price_close",
  "market_cap",
]);

/** True if this (resolved) bw_sym_id is served derived-only. */
export function isRestrictedSourceSymbol(bwSymId: string): boolean {
  return RESTRICTED_SOURCE_SYMBOLS.has(bwSymId);
}

/** Requested metric keys minus the raw-series set (for restricted symbols). */
export function dropRawSeriesKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => !RAW_SERIES_KEYS.has(k.trim()));
}

/** Drop raw-series columns from a wide row (restricted-source symbols). */
export function stripRawSeries<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const k of RAW_SERIES_KEYS) delete (out as Record<string, unknown>)[k];
  return out;
}

/** Machine-readable marker attached to responses that had raw fields withheld. */
export const RESTRICTED_SOURCE_NOTE = {
  data_license: "derived_only",
  reason:
    "Price history for this symbol is sourced from licensed survivorship data; " +
    "raw price/return series are not redistributable. Derived metrics are unrestricted.",
} as const;
