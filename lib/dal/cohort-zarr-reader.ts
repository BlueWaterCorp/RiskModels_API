/**
 * Cohort store reader — `ds_erm3_cohorts_{market_factor_etf}_{universe}.zarr` (ERM3 H.146).
 *
 * Cross-sectional residual statistics at (teo × cohort), where a cohort is the
 * market (L1), a GICS sector (L2), or a subsector (L3). This is the first ERM3
 * artifact published at cohort level rather than per-stock.
 *
 * WHY IT EXISTS — the no-intercept contract
 * -----------------------------------------
 * ERM3 fits its regressions WITHOUT an intercept, deliberately, so each stock's
 * residual retains its alpha. That is correct for a risk product, but it means
 * the cross-sectional mean residual is NOT zero, and until this store there was
 * no way for a consumer to see it. `residual_mean` is that quantity per
 * (teo, cohort): anyone building a relative-ranking signal must subtract it at
 * the level their residual is defined against (sector residuals demean within
 * L2, subsector within L3).
 *
 * The store carries the contract text itself in `attrs.no_intercept_contract`,
 * so the API surfaces it programmatically rather than hard-coding a copy that
 * can drift — see `readCohortStoreMeta()`.
 *
 * IDENTITY — ticker out, bw_sym_id in
 * -----------------------------------
 * The zarr's `cohort` coordinate is a `bw_sym_id`, and that is the correct
 * internal join key against ds_etf. It is NOT the public address: all twelve
 * public cohort ids fall in the licensed-identifier-derived tail of that
 * namespace, which `lib/dal/sym-id-scrub.ts` exists precisely to keep out of
 * API responses (H.24). So `bw_sym_id` stays inside this module and callers
 * address cohorts by ticker, matching the repo identity rule and the existing
 * public ETF surface.
 *
 * The point-in-time objection to ticker-joining does not bite for the public
 * set — all 12 L1/L2 cohorts span the full panel with an open `valid_to`. L3
 * cohorts do carry real instrument lifecycle, so their roster entries keep
 * `valid_from`/`valid_to` and the reader honours them.
 *
 * IP BOUNDARY: this module reads all 54 cohorts. Restricting to the public
 * 12 (`cohort_level <= 2`) is the service layer's job — see
 * lib/risk/cohort-service.ts. Nothing here should be exposed unfiltered.
 *
 * Never put bucket names, gs:// URLs, or zarr paths in thrown errors or API JSON.
 */

import type { AbsolutePath, Readable } from "@zarrita/storage";
import { Storage } from "@google-cloud/storage";
import type { Bucket } from "@google-cloud/storage";
import { get, open, root, slice, tryWithConsolidated, UnicodeStringArray } from "zarrita";
import type { Group } from "zarrita";
import {
  parseZarrGcsPrefix,
  zarrCohortsBasename,
  zarrEtfBasename,
  getZarrFactorSetId,
} from "@/lib/zarr-config";
import { scrubBwSymId } from "@/lib/dal/sym-id-scrub";

let _storage: Storage | null = null;

function getGcs(): Storage {
  if (!_storage) {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        _storage = new Storage({ credentials: JSON.parse(raw) as Record<string, unknown> });
      } catch {
        console.error("[cohort-zarr] GCP_SERVICE_ACCOUNT_JSON parse failed");
        _storage = new Storage();
      }
    } else {
      const keyFile = process.env.RISKMODELS_GCS_KEYFILE?.trim();
      _storage = keyFile ? new Storage({ keyFilename: keyFile }) : new Storage();
    }
  }
  return _storage;
}

class GcsZarrStore {
  constructor(
    private readonly bucket: Bucket,
    private readonly zarrObjectPrefix: string,
  ) {}

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    try {
      const [buf] = await this.bucket.file(objectName).download();
      return new Uint8Array(buf);
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 404) return undefined;
      console.error("[cohort-zarr] storage read failed");
      throw new Error("Zarr read failed");
    }
  }
}

const GROUP_TTL_MS = 30 * 60 * 1000;
const groupCache = new Map<string, { grp: Group<Readable>; at: number }>();

async function openGroup(basename: string): Promise<Group<Readable> | null> {
  const now = Date.now();
  const hit = groupCache.get(basename);
  if (hit && now - hit.at < GROUP_TTL_MS) return hit.grp;

  const { bucket: bucketName, basePath } = parseZarrGcsPrefix();
  const fullPrefix = `${basePath}/${basename}`.replace(/\/+/g, "/").replace(/^\//, "");
  try {
    const bucket = getGcs().bucket(bucketName);
    const consolidated = await tryWithConsolidated(new GcsZarrStore(bucket, fullPrefix));
    const grp = (await open.v2(root(consolidated as unknown as Readable), {
      kind: "group",
    })) as Group<Readable>;
    groupCache.set(basename, { grp, at: now });
    return grp;
  } catch {
    console.error("[cohort-zarr] open group failed");
    return null;
  }
}

async function openCohortGroup(): Promise<Group<Readable> | null> {
  return openGroup(zarrCohortsBasename());
}

// ── Variables ────────────────────────────────────────────────────────────────

/**
 * The 17 numeric (teo × cohort) planes. `proxy_source` is handled separately
 * (it is a string plane) and the coords live on the roster.
 *
 * Grouped by what a caller is actually asking for, because the endpoint lets
 * them request a subset and each plane is a separate object read.
 */
export const COHORT_DISTRIBUTION_VARS = [
  "residual_mean",
  "residual_mean_cw",
  "residual_sd",
  "residual_skew",
  "residual_p10",
  "residual_p90",
  "mean_pairwise_corr",
] as const;

export const COHORT_BREADTH_VARS = [
  "n_names",
  "n_effective",
  "weight_top1",
  "membership_churn",
] as const;

export const COHORT_FACTOR_VARS = [
  "linked_beta",
  "link_fit_resid_sd",
  "linked_beta_r2",
  "linked_beta_roll63",
  "cohort_factor_return",
  "cohort_residual_return",
  "cohort_ER",
  "factor_source",
] as const;

export const COHORT_NUMERIC_VARS = [
  ...COHORT_DISTRIBUTION_VARS,
  ...COHORT_BREADTH_VARS,
  ...COHORT_FACTOR_VARS,
] as const;

export type CohortNumericVar = (typeof COHORT_NUMERIC_VARS)[number];

const NUMERIC_VAR_SET = new Set<string>(COHORT_NUMERIC_VARS);

export function isCohortNumericVar(v: string): v is CohortNumericVar {
  return NUMERIC_VAR_SET.has(v);
}

/** Integer-valued planes — rendered without a fractional part by consumers. */
export const COHORT_INTEGER_VARS = new Set<string>([
  "n_names",
  "membership_churn",
  "factor_source",
]);

// ── Roster (coords) ──────────────────────────────────────────────────────────

export type CohortLevel = 1 | 2 | 3;

/** One cohort's identity. `bwSymId` is internal — never serialize it. */
export interface CohortRosterEntry {
  /** Index on the `cohort` axis. */
  index: number;
  /** INTERNAL join key against ds_etf. Do not expose — see H.24 and the
   *  identity note in this module's header. */
  bwSymId: string;
  /** Public address, and the display label. */
  ticker: string;
  level: CohortLevel;
  /** Parent's ticker; null for L1. */
  parentTicker: string | null;
  validFrom: string | null;
  /** null = still open. */
  validTo: string | null;
}

export interface CohortRoster {
  entries: CohortRosterEntry[];
  byTicker: Map<string, CohortRosterEntry>;
  teos: string[];
}

/** Decode a CF-encoded int64 day-offset array using its OWN `units` attr.
 *
 * Every date array in this store uses a different epoch — `teo` is
 * "days since 2000-01-03", `valid_from` is "days since 2000-01-04" — so the
 * epoch must be read per array and never assumed (not even assumed to be unix).
 * NaT is INT64_MIN and decodes to null.
 */
const NAT = -9223372036854775808n;
const MS_PER_DAY = 86_400_000;

async function readCfDateArray(
  grp: Group<Readable>,
  name: string,
): Promise<(string | null)[] | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
    const units = typeof attrs.units === "string" ? attrs.units : "";
    const m = units.match(/^days since (\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2})?/);
    if (!(d instanceof BigInt64Array) || !m) return null;
    const baseMs = Date.parse(`${m[1]}T00:00:00Z`);
    if (!Number.isFinite(baseMs)) return null;
    return Array.from(d, (v) => {
      if (v === NAT) return null;
      const dt = new Date(baseMs + Number(v) * MS_PER_DAY);
      return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
    });
  } catch {
    return null;
  }
}

/** Read a 1-D string coord (object/vlen-utf8 or fixed-width unicode). */
async function readStringCoord(grp: Group<Readable>, name: string): Promise<string[] | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      return Array.from({ length: d.length }, (_, i) => String(d.get(i)).trim());
    }
    if (Array.isArray(d)) return d.map((x) => String(x ?? "").trim());
    return null;
  } catch {
    return null;
  }
}

async function readIntCoord(grp: Group<Readable>, name: string): Promise<number[] | null> {
  try {
    const arr = await open.v2(grp.resolve(name), { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof BigInt64Array) return Array.from(d, (x) => Number(x));
    if (ArrayBuffer.isView(d)) return Array.from(d as unknown as ArrayLike<number>, Number);
    return null;
  } catch {
    return null;
  }
}

const ROSTER_TTL_MS = 30 * 60 * 1000;
let _roster: { value: CohortRoster; at: number } | null = null;

/**
 * Cohort roster + teo axis. Cached in-process — the coords are ~54 entries
 * written once nightly, and every query needs them.
 */
export async function readCohortRoster(): Promise<CohortRoster | null> {
  const now = Date.now();
  if (_roster && now - _roster.at < ROSTER_TTL_MS) return _roster.value;

  const grp = await openCohortGroup();
  if (!grp) return null;

  const [ids, tickers, parents, levels, validFrom, validTo, teos] = await Promise.all([
    readStringCoord(grp, "cohort"),
    readStringCoord(grp, "ticker"),
    readStringCoord(grp, "parent_cohort"),
    readIntCoord(grp, "cohort_level"),
    readCfDateArray(grp, "valid_from"),
    readCfDateArray(grp, "valid_to"),
    readCfDateArray(grp, "teo"),
  ]);

  if (!ids?.length || !tickers?.length || !levels?.length || !teos?.length) return null;

  // bw_sym_id → ticker, so parent_cohort (a bw_sym_id) resolves to a public label.
  const tickerById = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const tk = tickers[i];
    if (id && tk) tickerById.set(id, tk.toUpperCase());
  }

  const entries: CohortRosterEntry[] = [];
  const byTicker = new Map<string, CohortRosterEntry>();
  for (let i = 0; i < ids.length; i++) {
    const bwSymId = ids[i];
    const ticker = tickers[i]?.toUpperCase();
    const lvl = levels[i];
    if (!bwSymId || !ticker || (lvl !== 1 && lvl !== 2 && lvl !== 3)) continue;
    const parentId = parents?.[i]?.trim() ?? "";
    const entry: CohortRosterEntry = {
      index: i,
      bwSymId,
      ticker,
      level: lvl,
      parentTicker: parentId ? (tickerById.get(parentId) ?? null) : null,
      validFrom: validFrom?.[i] ?? null,
      validTo: validTo?.[i] ?? null,
    };
    entries.push(entry);
    byTicker.set(ticker, entry);
  }

  const teoStrings = teos.map((t) => t ?? "");
  const value: CohortRoster = { entries, byTicker, teos: teoStrings };
  _roster = { value, at: now };
  return value;
}

// ── Numeric planes ───────────────────────────────────────────────────────────

/**
 * Whole-plane cache, keyed by variable name.
 *
 * The store is chunked {teo: 3342, cohort: 27} — two chunks along each axis —
 * so ANY read of a single cohort's history already pulls half the plane, and a
 * one-teo cross-section pulls the entire plane. Slicing finer than a plane buys
 * nothing here. Each f32 plane is 6684 × 54 × 4B ≈ 1.4 MB, the store is ~18 MB
 * total, and the bytes are rewritten once nightly — so caching decoded planes
 * whole is both the cheapest and the simplest correct thing to do.
 */
const PLANE_TTL_MS = 30 * 60 * 1000;
const PLANE_CACHE_MAX = 24;
const planeCache = new Map<
  string,
  { at: number; promise: Promise<Float64Array | null> }
>();

function planeCacheGet(key: string): Promise<Float64Array | null> | null {
  const hit = planeCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PLANE_TTL_MS) {
    planeCache.delete(key);
    return null;
  }
  // Refresh LRU position.
  planeCache.delete(key);
  planeCache.set(key, hit);
  return hit.promise;
}

function planeCacheSet(key: string, promise: Promise<Float64Array | null>): void {
  planeCache.set(key, { at: Date.now(), promise });
  while (planeCache.size > PLANE_CACHE_MAX) {
    const oldest = planeCache.keys().next().value;
    if (oldest === undefined) break;
    planeCache.delete(oldest);
  }
}

/**
 * Read one full (teo × cohort) numeric plane, flattened row-major, as f64 with
 * non-finite cells as NaN. Integer planes widen losslessly (i32/i8 → f64).
 */
async function readNumericPlane(
  grp: Group<Readable>,
  varName: string,
  nTeo: number,
  nCohort: number,
): Promise<Float64Array | null> {
  const cached = planeCacheGet(varName);
  if (cached) return cached;

  const promise = (async (): Promise<Float64Array | null> => {
    try {
      const arr = await open.v2(grp.resolve(varName), { kind: "array" });
      const ch = await get(arr, [slice(0, nTeo), slice(0, nCohort)]);
      const d = ch?.data;
      if (!ArrayBuffer.isView(d)) return null;
      const src = d as unknown as ArrayLike<number | bigint>;
      const out = new Float64Array(nTeo * nCohort);
      for (let i = 0; i < out.length; i++) {
        const v = Number(src[i]);
        out[i] = Number.isFinite(v) ? v : Number.NaN;
      }
      return out;
    } catch {
      console.error("[cohort-zarr] plane read failed");
      return null;
    }
  })();

  planeCacheSet(varName, promise);
  return promise;
}

/**
 * bw_sym_id → ticker for the ETF roster, built from `ds_etf`'s own `symbol` and
 * `ticker` coords.
 *
 * `proxy_source` names the instrument backing a cohort's factor as a bw_sym_id,
 * and for most ETFs those fall in the licensed-identifier-derived tail of the
 * namespace. Emitting them raw would redistribute licensed identifiers, so they
 * are resolved to tickers here and scrubbed if resolution fails. Cached for the
 * same reason and duration as the cohort roster: ~100 entries, rewritten nightly.
 */
const ETF_TICKER_TTL_MS = 30 * 60 * 1000;
let _etfTickerById: { value: Map<string, string>; at: number } | null = null;

async function readEtfTickerById(): Promise<Map<string, string>> {
  const now = Date.now();
  if (_etfTickerById && now - _etfTickerById.at < ETF_TICKER_TTL_MS) {
    return _etfTickerById.value;
  }
  const map = new Map<string, string>();
  const grp = await openGroup(zarrEtfBasename());
  if (grp) {
    const [symbols, tickers] = await Promise.all([
      readStringCoord(grp, "symbol"),
      readStringCoord(grp, "ticker"),
    ]);
    if (symbols && tickers) {
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const tk = tickers[i];
        if (sym && tk) map.set(sym, tk.toUpperCase());
      }
    }
  }
  _etfTickerById = { value: map, at: now };
  return map;
}

/**
 * Public label for a `proxy_source` cell. Resolves to a ticker where the
 * instrument is in the ETF roster; otherwise falls back to the scrub, which
 * passes through non-licensed forms (synthetic `FFX_*` index ids) and replaces
 * anything from the licensed-derived tail that could not be resolved.
 */
export function publicProxyLabel(
  raw: string,
  tickerById: Map<string, string>,
): string | null {
  const id = raw.trim();
  if (!id) return null;
  const ticker = tickerById.get(id);
  if (ticker) return ticker;
  return scrubBwSymId(id);
}

/** `proxy_source` is a string plane — read one cohort column over a teo range. */
async function readProxySourceColumn(
  grp: Group<Readable>,
  cohortIdx: number,
  t0: number,
  t1: number,
): Promise<string[] | null> {
  try {
    const arr = await open.v2(grp.resolve("proxy_source"), { kind: "array" });
    const ch = await get(arr, [slice(t0, t1), cohortIdx]);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      return Array.from({ length: d.length }, (_, i) => String(d.get(i)).trim());
    }
    if (Array.isArray(d)) return d.map((x) => String(x ?? "").trim());
    return null;
  } catch {
    return null;
  }
}

function lowerBound(sorted: string[], x: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index strictly greater than x — pair with `[t0, t1)` to include x. */
function upperBoundInclusive(sorted: string[], x: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function resolveTeoIndex(teos: string[], teo?: string): number {
  if (!teo) return teos.length - 1;
  const exact = teos.indexOf(teo);
  if (exact >= 0) return exact;
  const prior = upperBoundInclusive(teos, teo) - 1;
  return prior >= 0 ? prior : teos.length - 1;
}

// ── Public read shapes ───────────────────────────────────────────────────────

export interface CohortSeriesPoint {
  date: string;
  /** Requested variables. Thin-cohort rows are dropped, not zero-filled. */
  values: Record<string, number | null>;
  /** Present only when `proxy_source` was requested. */
  proxy_source?: string | null;
}

export interface CohortSeries {
  ticker: string;
  level: CohortLevel;
  parent: string | null;
  points: CohortSeriesPoint[];
  /** Fraction of returned points where the factor came from a substitute
   *  instrument (`factor_source != 0`). Callers must surface this. */
  proxied_fraction: number;
}

export interface CohortCrossSectionRow {
  ticker: string;
  level: CohortLevel;
  parent: string | null;
  values: Record<string, number | null>;
}

/**
 * Per-cohort time series over [startDate, endDate].
 *
 * `minNames` drops days whose `n_names` is below the threshold rather than
 * returning them as noise — a four-name cohort's `residual_mean` and
 * `residual_sd` are not meaningful, and the caller should not have to know
 * that to avoid plotting it. `n_names` is always read for this reason even
 * when not requested.
 */
export async function readCohortSeries(params: {
  tickers: string[];
  variables: readonly string[];
  startDate?: string;
  endDate?: string;
  minNames?: number;
  includeProxySource?: boolean;
}): Promise<CohortSeries[] | null> {
  const grp = await openCohortGroup();
  const roster = await readCohortRoster();
  if (!grp || !roster) return null;

  const { teos } = roster;
  const nTeo = teos.length;
  const nCohort = roster.entries.length;

  const t0 = params.startDate ? lowerBound(teos, params.startDate) : 0;
  const t1 = params.endDate ? upperBoundInclusive(teos, params.endDate) : nTeo;
  if (t1 <= t0) return [];

  const requested = params.variables.filter(isCohortNumericVar);
  // n_names gates the statistics; factor_source drives the proxy disclosure.
  const needed = Array.from(new Set<string>([...requested, "n_names", "factor_source"]));

  const planes = new Map<string, Float64Array | null>();
  await Promise.all(
    needed.map(async (v) => {
      planes.set(v, await readNumericPlane(grp, v, nTeo, nCohort));
    }),
  );

  const minNames = params.minNames ?? 0;
  const out: CohortSeries[] = [];
  const etfTickerById = params.includeProxySource
    ? await readEtfTickerById()
    : new Map<string, string>();

  for (const ticker of params.tickers) {
    const entry = roster.byTicker.get(ticker.trim().toUpperCase());
    if (!entry) continue;

    const proxyCol = params.includeProxySource
      ? await readProxySourceColumn(grp, entry.index, t0, t1)
      : null;

    const points: CohortSeriesPoint[] = [];
    let proxied = 0;
    for (let t = t0; t < t1; t++) {
      const date = teos[t];
      if (!date) continue;
      const flat = t * nCohort + entry.index;

      const nNames = planes.get("n_names")?.[flat];
      if (nNames == null || !Number.isFinite(nNames) || nNames < minNames) continue;

      const values: Record<string, number | null> = {};
      for (const v of requested) {
        const raw = planes.get(v)?.[flat];
        values[v] = raw == null || !Number.isFinite(raw) ? null : raw;
      }

      const fsrc = planes.get("factor_source")?.[flat];
      if (Number.isFinite(fsrc) && fsrc !== 0) proxied++;

      const point: CohortSeriesPoint = { date, values };
      if (proxyCol) {
        const raw = proxyCol[t - t0];
        point.proxy_source = raw ? publicProxyLabel(raw, etfTickerById) : null;
      }
      points.push(point);
    }

    out.push({
      ticker: entry.ticker,
      level: entry.level,
      parent: entry.parentTicker,
      points,
      proxied_fraction: points.length ? proxied / points.length : 0,
    });
  }

  return out;
}

/**
 * One-teo cross-section across cohorts. `teo` snaps back to the most recent
 * prior trading day when the requested date is not itself one.
 */
export async function readCohortCrossSection(params: {
  tickers?: string[];
  variables: readonly string[];
  teo?: string;
  minNames?: number;
}): Promise<{ teo: string; rows: CohortCrossSectionRow[] } | null> {
  const grp = await openCohortGroup();
  const roster = await readCohortRoster();
  if (!grp || !roster) return null;

  const { teos } = roster;
  const nTeo = teos.length;
  const nCohort = roster.entries.length;
  const teoIdx = resolveTeoIndex(teos, params.teo);
  const teoStr = teos[teoIdx];
  if (!teoStr) return null;

  const requested = params.variables.filter(isCohortNumericVar);
  const needed = Array.from(new Set<string>([...requested, "n_names"]));

  const planes = new Map<string, Float64Array | null>();
  await Promise.all(
    needed.map(async (v) => {
      planes.set(v, await readNumericPlane(grp, v, nTeo, nCohort));
    }),
  );

  const wanted = params.tickers?.length
    ? new Set(params.tickers.map((t) => t.trim().toUpperCase()))
    : null;
  const minNames = params.minNames ?? 0;

  const rows: CohortCrossSectionRow[] = [];
  for (const entry of roster.entries) {
    if (wanted && !wanted.has(entry.ticker)) continue;

    const flat = teoIdx * nCohort + entry.index;
    const nNames = planes.get("n_names")?.[flat];
    if (nNames == null || !Number.isFinite(nNames) || nNames < minNames) continue;

    const values: Record<string, number | null> = {};
    for (const v of requested) {
      const raw = planes.get(v)?.[flat];
      values[v] = raw == null || !Number.isFinite(raw) ? null : raw;
    }
    rows.push({
      ticker: entry.ticker,
      level: entry.level,
      parent: entry.parentTicker,
      values,
    });
  }

  rows.sort((a, b) => a.level - b.level || a.ticker.localeCompare(b.ticker));
  return { teo: teoStr, rows };
}

// ── Store metadata ───────────────────────────────────────────────────────────

export interface CohortStoreMeta {
  /** The no-intercept contract, read from the store so it cannot drift. */
  no_intercept_contract: string | null;
  return_source_legend: string | null;
  build_timestamp: string | null;
  erm3_version: string | null;
  market_factor_etf: string | null;
  universe: string | null;
  rolling_window: number | null;
  min_periods: number | null;
  panel_start: string | null;
  panel_end: string | null;
}

function attrString(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function attrNumber(attrs: Record<string, unknown>, key: string): number | null {
  const v = attrs[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function readCohortStoreMeta(): Promise<CohortStoreMeta | null> {
  const grp = await openCohortGroup();
  const roster = await readCohortRoster();
  if (!grp || !roster) return null;

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  return {
    no_intercept_contract: attrString(attrs, "no_intercept_contract"),
    return_source_legend: attrString(attrs, "return_source_legend"),
    build_timestamp: attrString(attrs, "build_timestamp"),
    erm3_version: attrString(attrs, "erm3_version"),
    market_factor_etf: attrString(attrs, "market_factor_etf"),
    universe: attrString(attrs, "universe") ?? getZarrFactorSetId(),
    rolling_window: attrNumber(attrs, "rolling_window"),
    min_periods: attrNumber(attrs, "min_periods"),
    panel_start: roster.teos[0] ?? null,
    panel_end: roster.teos[roster.teos.length - 1] ?? null,
  };
}
