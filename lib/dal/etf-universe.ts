/**
 * ETF universe — one list of every fund the API knows, with three capabilities
 * (RMAPI-14):
 *
 *   cascade   SPY, sector and subsector ETFs the ERM3 cascade hedges with
 *             (weekly hedge snapshot coords; public market + sector list as
 *             fallback when that store is unreachable)
 *   priced    daily returns in the ETF return store (ds_etf symbol axis) —
 *             what /ticker-returns, covariance and beta to SPY can use
 *   holdings  look-through holdings in the committed catalog
 *             (mcp/data/etf_master.json) — /data/etf/{ticker}/holdings,
 *             benchmark fit
 *
 * Optional: `mcp/data/etf_register.json` (ERM3 register mirror) when present
 * adds funds, names, factor roles (style, macro:<factor>) and identifiers. Its
 * absence is normal; the other three sources are enough.
 *
 * Identifiers: FIGI, CIK and BW ids only. A bw_sym_id that embeds a licensed
 * identifier is withheld (null).
 *
 * The built universe is cached in-process for UNIVERSE_TTL_MS; the inputs
 * change at most daily.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { listEtfEntries } from "@/lib/dal/etf-catalog";
import { readCascadeEtfSets, readEtfStoreIndex } from "@/lib/dal/zarr-reader";
import { ETF_FACTOR_REGISTRY } from "@/lib/risk/etf-factor-classification";

export type EtfFactorRole = "market" | "sector" | "subsector" | "style" | `macro:${string}` | "none";

export interface EtfCapabilities {
  cascade: boolean;
  priced: boolean;
  /** First date with a daily return in the store (null when not priced). */
  priced_from: string | null;
  holdings: boolean;
  /** Latest holdings report date. Filled by /data/etf/{ticker}; null in list views. */
  holdings_as_of: string | null;
  factor_role: EtfFactorRole;
}

export interface EtfIdentifiers {
  bw_sym_id: string | null;
  bw_etf_id: string | null;
  figi: string | null;
  cik: string | null;
  ticker: string;
}

export interface EtfUniverseRow {
  ticker: string;
  name: string | null;
  capabilities: EtfCapabilities;
  identifiers: EtfIdentifiers;
}

export interface EtfUniverse {
  rows: EtfUniverseRow[];
  counts: { total: number; cascade: number; priced: number; holdings: number };
  sources: {
    catalog: boolean;
    priced_store: boolean;
    cascade_store: boolean;
    register: boolean;
  };
  built_at: string;
}

/** Reason codes shared with /portfolio/exposure and /ticker-returns. */
export const ETF_REASON_CODES = {
  outside_priced: "etf_outside_priced_universe",
  no_history_in_window: "etf_no_return_history_in_window",
  not_found: "symbol_not_found",
} as const;

const UNIVERSE_TTL_MS = 60 * 60 * 1000;

// ── identifier hygiene ─────────────────────────────────────────────────────

/** 12-char country-prefixed security id shape — never served. */
const LICENSED_ID_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const FIGI_SHAPE = /^BBG[A-Z0-9]{9}$/;

/** Withhold bw_sym_ids that embed a licensed identifier. */
export function safeBwSymId(id: string | null | undefined): string | null {
  if (!id) return null;
  const v = id.trim();
  if (!v.startsWith("BW-")) return null;
  const body = v.slice(3);
  // FIGIs share the 12-char shape; they are open identifiers and served.
  if (!FIGI_SHAPE.test(body) && LICENSED_ID_SHAPE.test(body)) return null;
  return v;
}

/** FIGI from an explicit value or a FIGI-based bw_sym_id (BW-BBG…). */
export function figiFrom(explicit: string | null | undefined, bwSymId: string | null): string | null {
  const e = explicit?.trim().toUpperCase();
  if (e && FIGI_SHAPE.test(e)) return e;
  if (bwSymId && FIGI_SHAPE.test(bwSymId.slice(3))) return bwSymId.slice(3);
  return null;
}

// ── optional register mirror ───────────────────────────────────────────────

interface RegisterRow {
  ticker: string;
  name?: string | null;
  factor_role?: string | null;
  cascade?: boolean | null;
  bw_sym_id?: string | null;
  figi?: string | null;
  cik?: string | number | null;
}

function loadRegister(): RegisterRow[] | null {
  const p = join(process.cwd(), "mcp", "data", "etf_register.json");
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    let raw: unknown[] = [];
    if (Array.isArray(parsed)) raw = parsed;
    else if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const inner = o.etfs ?? o.entries ?? o.rows;
      if (Array.isArray(inner)) raw = inner;
      // Keyed shape (etf-register/1.0): { etfs: { TICKER: { role } } }.
      else if (inner && typeof inner === "object")
        raw = Object.entries(inner as Record<string, unknown>).map(([k, v]) =>
          v && typeof v === "object" ? { ticker: k, ...(v as object) } : null,
        );
    }
    return raw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        ...(r as object),
        ticker: String(r.ticker ?? "").trim().toUpperCase(),
        factor_role: (r.factor_role ?? r.role ?? null) as string | null,
      }) as RegisterRow)
      .filter((r) => r.ticker);
  } catch {
    return null;
  }
}

function normalizeRole(role: string | null | undefined): EtfFactorRole | null {
  if (!role) return null;
  const r = role.trim().toLowerCase();
  if (r === "market" || r === "sector" || r === "subsector" || r === "style" || r === "none") return r;
  if (r.startsWith("macro:") && r.length > 6) return r as `macro:${string}`;
  if (r === "macro") return "macro:unspecified";
  return null;
}

// ── build ──────────────────────────────────────────────────────────────────

export async function buildEtfUniverse(): Promise<EtfUniverse> {
  const catalog = listEtfEntries();
  const [store, cascade] = await Promise.all([
    readEtfStoreIndex().catch(() => null),
    readCascadeEtfSets().catch(() => null),
  ]);
  const register = loadRegister();

  const market = cascade?.market ?? "SPY";
  const sectors = new Set(
    cascade?.sectors ?? ETF_FACTOR_REGISTRY.filter((e) => e.sleeve === "sector").map((e) => e.ticker),
  );
  const subsectors = new Set(cascade?.subsectors ?? []);

  const byTicker = new Map<string, EtfUniverseRow>();
  const row = (ticker: string): EtfUniverseRow => {
    const t = ticker.trim().toUpperCase();
    let r = byTicker.get(t);
    if (!r) {
      r = {
        ticker: t,
        name: null,
        capabilities: {
          cascade: false,
          priced: false,
          priced_from: null,
          holdings: false,
          holdings_as_of: null,
          factor_role: "none",
        },
        identifiers: { bw_sym_id: null, bw_etf_id: null, figi: null, cik: null, ticker: t },
      };
      byTicker.set(t, r);
    }
    return r;
  };

  for (const e of catalog) {
    const r = row(e.ticker);
    r.name = e.name ?? r.name;
    r.capabilities.holdings = true;
    r.identifiers.bw_etf_id = e.bw_etf_id;
  }

  for (const s of store ?? []) {
    const r = row(s.ticker);
    r.capabilities.priced = true;
    r.capabilities.priced_from = s.priced_from;
    r.identifiers.bw_sym_id = safeBwSymId(s.bw_sym_id);
  }

  const markCascade = (t: string, role: EtfFactorRole) => {
    const r = row(t);
    r.capabilities.cascade = true;
    r.capabilities.factor_role = role;
  };
  markCascade(market, "market");
  for (const t of sectors) markCascade(t, "sector");
  for (const t of subsectors) markCascade(t, "subsector");
  // Public names for the market + sector funds when no other source has one.
  for (const e of ETF_FACTOR_REGISTRY) {
    const r = byTicker.get(e.ticker);
    if (r && !r.name) r.name = e.name;
  }

  for (const g of register ?? []) {
    const r = row(g.ticker);
    if (g.name && !r.name) r.name = g.name;
    const role = normalizeRole(g.factor_role);
    // Cascade roles come from the live model store; the register adds style
    // and macro roles, and fills cascade roles only when the store had none.
    const cascadeRole = role === "market" || role === "sector" || role === "subsector";
    if (role && (cascade ? !cascadeRole && r.capabilities.factor_role === "none" : true)) {
      r.capabilities.factor_role = role;
    }
    if (g.cascade === true && !cascade) r.capabilities.cascade = true;
    if (!r.identifiers.bw_sym_id) r.identifiers.bw_sym_id = safeBwSymId(g.bw_sym_id ?? null);
    if (g.cik != null && String(g.cik).trim()) r.identifiers.cik = String(g.cik).trim().padStart(10, "0");
    if (g.figi) r.identifiers.figi = figiFrom(g.figi, null);
  }

  for (const r of byTicker.values()) {
    if (!r.identifiers.figi) r.identifiers.figi = figiFrom(null, r.identifiers.bw_sym_id);
  }

  const rows = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    rows,
    counts: {
      total: rows.length,
      cascade: rows.filter((r) => r.capabilities.cascade).length,
      priced: rows.filter((r) => r.capabilities.priced).length,
      holdings: rows.filter((r) => r.capabilities.holdings).length,
    },
    sources: {
      catalog: catalog.length > 0,
      priced_store: store !== null,
      cascade_store: cascade !== null,
      register: register !== null,
    },
    built_at: new Date().toISOString(),
  };
}

let _cache: { at: number; promise: Promise<EtfUniverse> } | null = null;

/** Cached universe (in-process, UNIVERSE_TTL_MS). A partial build (a store unreachable) is cached for 5 minutes only. */
export function getEtfUniverse(): Promise<EtfUniverse> {
  const now = Date.now();
  if (_cache && now - _cache.at < UNIVERSE_TTL_MS) return _cache.promise;
  const promise = buildEtfUniverse().then((u) => {
    if (!u.sources.priced_store || !u.sources.cascade_store) {
      // Retry sooner than the full TTL.
      if (_cache) _cache.at = Date.now() - UNIVERSE_TTL_MS + 5 * 60 * 1000;
    }
    return u;
  });
  _cache = { at: now, promise };
  promise.catch(() => {
    _cache = null;
  });
  return promise;
}

/** Test seam. */
export function _resetEtfUniverseCache(): void {
  _cache = null;
}

export async function getEtfUniverseRow(ticker: string): Promise<EtfUniverseRow | null> {
  const t = (ticker ?? "").trim().toUpperCase();
  if (!t) return null;
  const u = await getEtfUniverse();
  return u.rows.find((r) => r.ticker === t) ?? null;
}

/** Capability filters accepted by /data/etf/universe and /data/etf/search. */
export interface EtfCapabilityFilter {
  cascade?: boolean;
  priced?: boolean;
  holdings?: boolean;
  factor_role?: string;
}

function parseBool(v: string | null): boolean | undefined {
  if (v == null) return undefined;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

export function parseCapabilityFilter(params: URLSearchParams): EtfCapabilityFilter {
  const role = params.get("factor_role")?.trim().toLowerCase();
  return {
    cascade: parseBool(params.get("cascade")),
    priced: parseBool(params.get("priced")),
    holdings: parseBool(params.get("holdings")),
    ...(role ? { factor_role: role } : {}),
  };
}

export function matchesCapabilityFilter(r: EtfUniverseRow, f: EtfCapabilityFilter): boolean {
  if (f.cascade !== undefined && r.capabilities.cascade !== f.cascade) return false;
  if (f.priced !== undefined && r.capabilities.priced !== f.priced) return false;
  if (f.holdings !== undefined && r.capabilities.holdings !== f.holdings) return false;
  if (f.factor_role) {
    const role = r.capabilities.factor_role;
    if (f.factor_role === "macro" ? !role.startsWith("macro:") : role !== f.factor_role) return false;
  }
  return true;
}

/**
 * Why a known ETF returned no daily returns: outside the priced universe, or
 * priced but with no rows in the requested window.
 */
export async function classifyEmptyEtfReturns(
  ticker: string,
): Promise<typeof ETF_REASON_CODES.outside_priced | typeof ETF_REASON_CODES.no_history_in_window> {
  try {
    const r = await getEtfUniverseRow(ticker);
    const u = await getEtfUniverse();
    // Store unreachable → we cannot say it is outside; report the window.
    if (!u.sources.priced_store) return ETF_REASON_CODES.no_history_in_window;
    return r?.capabilities.priced ? ETF_REASON_CODES.no_history_in_window : ETF_REASON_CODES.outside_priced;
  } catch {
    return ETF_REASON_CODES.no_history_in_window;
  }
}
