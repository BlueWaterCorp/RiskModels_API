/**
 * Entity-side Zarr reader on GCS (funds + 13F filers).
 *
 * Per-entity stores live at:
 *   gs://{bucket}/{basePath}/bw_fund_id/{BW-FUND-...}/{ds_portfolio,ds_ph,ds_hr,ds_nav}.zarr
 *   gs://{bucket}/{basePath}/bw_filer_id/{BW-FILER-CIK...}/{ds_portfolio,ds_ph}.zarr
 *   gs://{bucket}/{basePath}/bw_synth_id/{BW-SYNTH-...}/{ds_portfolio,ds_ph}.zarr
 *
 * Default GCS prefix is `rm_api_data/ERM3_Funds` (env override:
 * `ZARR_FUNDS_GCS_PREFIX`). The bucket is shared with the stocks-side
 * `rm_api_data` per ARCHITECTURE_FUNDS_API.md §3.1.1; only the basePath
 * differs.
 *
 * Per-domain tree split (Funds_DAG #76): the writer moved filer and ETF
 * trees out of the shared `ERM3_Funds` root into their own roots
 * (`ERM3_Filers/bw_filer_id/…`, `ERM3_ETFs/bw_etf_id/…`) — benchmarks moved
 * to a reference tree as well (`ERM3_Reference/bw_bench_id/…`). The reader
 * follows via three optional overrides, each tried FIRST with an automatic
 * fallback to the shared `ZARR_FUNDS_GCS_PREFIX` tree — the dual-read
 * window that covers the gap between the writer's #76 config change and
 * the next full/nuclear run that actually publishes the new trees:
 *   - `ZARR_FILERS_GCS_PREFIX` — filers + synthetic composites (synths share
 *     the filer-family tree, as they did pre-split)
 *   - `ZARR_ETFS_GCS_PREFIX`   — ETF sponsor holdings
 *   - `ZARR_BENCH_GCS_PREFIX`  — benchmark/reference surfaces
 * Funds, cohort cells (portfolio_style/, equity_style_9box/) stay on the
 * shared prefix — the funds domain tree did not move.
 *
 * Folder-as-entity-key convention (BWMACRO/docs/13f_pipeline_plan.md §2):
 * dataset names are universal (ds_ph, ds_portfolio); the path prefix
 * (`bw_fund_id/` vs `bw_filer_id/`) discriminates entity kind. ds_nav is
 * fund-only by design (no NAV time series for filers). ds_hr exists for filers
 * when D.8.10 Phase 3 writes hedge sleeves (sparse — reader mirrors funds).
 *
 * Internal-only: never expose bucket names, gs:// URLs, or zarr paths in
 * thrown errors or API JSON.
 *
 * TODO(dedup): the GCS plumbing here (getGcs, GcsZarrStore, openZarrGroupAt,
 * readTeoStrings) is structurally identical to lib/dal/zarr-reader.ts.
 * Extract to lib/dal/zarr-gcs.ts as a follow-up — kept duplicated so the
 * stocks-side module stays untouched.
 */

import { readFile } from "node:fs/promises";
import { Storage, type Bucket } from "@google-cloud/storage";
import {
  get,
  KeyError,
  NodeNotFoundError,
  open,
  root,
  slice,
  tryWithConsolidated,
  UnicodeStringArray,
} from "zarrita";
import type { AbsolutePath, Readable } from "@zarrita/storage";
import type { Group } from "zarrita";

import { lookupBenchmarkAlias } from "@/lib/dal/benchmark-catalog";
import {
  applyScrubToFilerHoldings,
  applyScrubToHoldings,
} from "@/lib/dal/symbols-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCache,
  setCache,
  CACHE_TTL,
  generateCacheKey,
  isSkippableCacheWarmPayload,
} from "@/lib/cache/redis";

// Fund/filer zarr + Supabase reads refresh weekly at most (13F filings
// quarterly, fund portfolios/NAV weekly, holdings-top quarterly) — see
// ARCHITECTURE_FUNDS_API.md. CACHE_TTL.HISTORICAL (24h) mirrors the TTL the
// funds/filer PDF snapshot routes already use for the same underlying data
// (`app/api/funds/snapshot.pdf/[bw_fund_id]/route.ts` et al.), so a cold cache
// self-heals within a day of any upstream backfill/correction instead of
// freezing stale data for the full refresh cadence.
const FUNDS_ZARR_CACHE_TTL = CACHE_TTL.HISTORICAL;

// ETF holdings and benchmark surfaces land daily (teo_frequency: "daily" —
// see the ETF/benchmark sections below), so the 24h TTL above would serve
// yesterday's snapshot all day. 1h keeps today's sponsor file visible within
// the hour.
const FUNDS_ZARR_DAILY_SURFACE_TTL = CACHE_TTL.DAILY;

// Empty results (missing zarr, unknown id, out-of-range window) are
// negative-cached briefly so repeat requests don't re-run GCS opens, while a
// fund's first-ever sync still appears within minutes — never reuse the full
// TTL for negatives.
const FUNDS_ZARR_NEGATIVE_TTL = CACHE_TTL.FREQUENT;

/** Sentinel stored for empty results — see `withZarrCache`. */
const EMPTY_SENTINEL = { __empty: true } as const;

/**
 * Shared get → compute → set wrapper for every cached reader in this file.
 *
 * - A `compute()` throw propagates and caches nothing, so transient
 *   GCS/Supabase failures are never pinned (see `readFloatSlice1d`'s error
 *   discrimination).
 * - Empty payloads (`null`, `[]` — per `isSkippableCacheWarmPayload`) are
 *   stored as a short-TTL sentinel and mapped back to `emptyValue` on read.
 * - `cacheable` lets a reader veto the write for a response it knows is
 *   suspect (e.g. a torn mid-sync Supabase read) while still returning it.
 * - Writes are fire-and-forget: the response never waits on Upstash.
 */
async function withZarrCache<T>(
  ck: string,
  compute: () => Promise<T>,
  opts: {
    /** Returned on a sentinel hit; the value shape `compute` uses for "nothing". */
    emptyValue: T;
    ttl?: number;
    cacheable?: (value: T) => boolean;
  },
): Promise<T> {
  const hit = await getCache<T | typeof EMPTY_SENTINEL>(ck);
  if (hit !== null && hit !== undefined) {
    return (hit as { __empty?: boolean }).__empty === true
      ? opts.emptyValue
      : (hit as T);
  }
  const value = await compute();
  if (isSkippableCacheWarmPayload(value)) {
    setCache(ck, EMPTY_SENTINEL, FUNDS_ZARR_NEGATIVE_TTL).catch(console.error);
  } else if (!opts.cacheable || opts.cacheable(value)) {
    setCache(ck, value, opts.ttl ?? FUNDS_ZARR_CACHE_TTL).catch(console.error);
  }
  return value;
}

let _storage: Storage | null = null;

function getGcs(): Storage {
  if (!_storage) {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        const credentials = JSON.parse(raw) as Record<string, unknown>;
        _storage = new Storage({ credentials });
      } catch {
        console.error("[funds-zarr] GCP_SERVICE_ACCOUNT_JSON parse failed");
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
    private readonly objectPrefix: string,
  ) {}

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.objectPrefix}/${rel}`.replace(/\/+/g, "/");
    try {
      const [buf] = await this.bucket.file(objectName).download();
      return new Uint8Array(buf);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err?.code === 404) return undefined;
      console.error("[funds-zarr] storage read failed");
      throw new Error("Zarr read failed");
    }
  }
}

/**
 * Local filesystem mirror of the funds zarr tree (dev/tests only). When
 * `ZARR_FUNDS_LOCAL_ROOT` is set, all reads in this module resolve against
 * `${root}/${relativePath}` instead of GCS. Unset in production.
 */
class FsZarrStore {
  constructor(private readonly rootDir: string) {}

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    try {
      const buf = await readFile(`${this.rootDir}/${rel}`);
      return new Uint8Array(buf);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "ENOENT" || err?.code === "EISDIR") return undefined;
      console.error("[funds-zarr] local read failed");
      throw new Error("Zarr read failed");
    }
  }
}

const FUNDS_ZARR_PREFIX_DEFAULT = "rm_api_data/ERM3_Funds";

function parseZarrPrefix(raw: string): { bucket: string; basePath: string } {
  const i = raw.indexOf("/");
  if (i <= 0) return { bucket: raw || "rm_api_data", basePath: "" };
  return { bucket: raw.slice(0, i), basePath: raw.slice(i + 1).replace(/\/$/, "") };
}

function parseFundsZarrPrefix(): { bucket: string; basePath: string } {
  return parseZarrPrefix(
    (process.env.ZARR_FUNDS_GCS_PREFIX ?? FUNDS_ZARR_PREFIX_DEFAULT).trim(),
  );
}

/**
 * Resolve the candidate GCS prefixes for a domain tree (Funds_DAG #76
 * split), most-preferred first: the per-domain override
 * (`domainEnv`, e.g. ZARR_FILERS_GCS_PREFIX → rm_api_data/ERM3_Filers) when
 * set and non-empty, then the shared `ZARR_FUNDS_GCS_PREFIX` (or its
 * default) as fallback.
 *
 * The fallback is the dual-read window: the writer cut over to per-domain
 * trees in #76 but publishes them only on the next full/nuclear run —
 * until then the moved trees don't exist in GCS and every read must land
 * on the old shared tree. Trying override-first then shared means reads
 * follow the split automatically once the writer publishes, and survive
 * the old tree's later retirement. Exported for tests.
 */
export function domainZarrPrefixCandidates(
  domainEnv: string,
): { bucket: string; basePath: string }[] {
  const shared = parseFundsZarrPrefix();
  const override = process.env[domainEnv]?.trim();
  if (!override) return [shared];
  const preferred = parseZarrPrefix(override);
  if (
    preferred.bucket === shared.bucket &&
    preferred.basePath === shared.basePath
  ) {
    return [shared];
  }
  return [preferred, shared];
}

async function openZarrGroupAtPrefix(
  relativePath: string,
  prefix: { bucket: string; basePath: string },
): Promise<Group<Readable> | null> {
  try {
    const fullPrefix = `${prefix.basePath}/${relativePath}`
      .replace(/\/+/g, "/")
      .replace(/^\//, "");
    const raw = new GcsZarrStore(getGcs().bucket(prefix.bucket), fullPrefix);
    const consolidated = await tryWithConsolidated(raw);
    const store = consolidated as unknown as Readable;
    return (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
  } catch {
    return null;
  }
}

async function openZarrGroupAt(
  relativePath: string,
  domainEnv?: string,
): Promise<Group<Readable> | null> {
  const localRoot = process.env.ZARR_FUNDS_LOCAL_ROOT?.trim();
  if (localRoot) {
    try {
      const raw = new FsZarrStore(
        `${localRoot}/${relativePath}`.replace(/\/+/g, "/"),
      );
      const consolidated = await tryWithConsolidated(raw);
      const store = consolidated as unknown as Readable;
      return (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
    } catch {
      console.error("[funds-zarr] open group failed");
      return null;
    }
  }
  // Domain-split reads (Funds_DAG #76): try the per-domain tree first, then
  // fall back to the shared tree — see domainZarrPrefixCandidates. The extra
  // attempt only fires while the moved tree is absent (a couple of 404s on
  // cache miss), and for entities that are genuinely missing either way.
  const candidates = domainEnv
    ? domainZarrPrefixCandidates(domainEnv)
    : [parseFundsZarrPrefix()];
  for (const prefix of candidates) {
    const grp = await openZarrGroupAtPrefix(relativePath, prefix);
    if (grp) return grp;
  }
  console.error("[funds-zarr] open group failed");
  return null;
}

async function openFundZarrGroup(
  bwFundId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  return openZarrGroupAt(`bw_fund_id/${bwFundId}/${basename}`);
}

/**
 * Synthetic composite entities (`BW-SYNTH-*`) live under `bw_synth_id/` with
 * the same per-entity dataset schemas as filers. The filer readers below are
 * polymorphic over both families via this id-prefix dispatch.
 */
export function isSyntheticEntityId(id: string): boolean {
  return id.startsWith("BW-SYNTH-");
}

async function openFilerZarrGroup(
  bwFilerId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  const family = isSyntheticEntityId(bwFilerId) ? "bw_synth_id" : "bw_filer_id";
  // Filers domain tree (Funds_DAG #76): ERM3_Filers/… when
  // ZARR_FILERS_GCS_PREFIX is set, else the shared funds prefix.
  return openZarrGroupAt(
    `${family}/${bwFilerId}/${basename}`,
    "ZARR_FILERS_GCS_PREFIX",
  );
}

/** Per-cell stores: portfolio_style/{Cell_Name}/... and equity_style_9box/{Cell_Name}/... */
async function openCohortZarrGroup(
  kind: "portfolio_style" | "equity_style_9box",
  pathComponent: string,
  basename: string,
): Promise<Group<Readable> | null> {
  return openZarrGroupAt(`${kind}/${pathComponent}/${basename}`);
}

/** NaT sentinel for numpy datetime64 stored as int64. */
const DATETIME64_NAT = -9223372036854775808n;

const _CF_UNIT_MS: Record<string, number> = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
  milliseconds: 1,
  microseconds: 1e-3,
  nanoseconds: 1e-6,
};

/**
 * Decode a numeric array of CF-encoded datetimes (`units: "<unit> since <date>"`,
 * the standard xarray/zarr encoding) — or, when there's no CF `units` attr, a raw
 * int64-nanoseconds-since-epoch array (numpy `datetime64[ns]`) — into ISO date
 * strings; NaT → "".
 *
 * Works for whatever numeric typed array zarrita hands back for the dtype: `<i8`
 * may surface as `BigInt64Array`, but some codecs/paths surface `Float64Array`/
 * `Int32Array`. The CF branch is tried regardless of typed-array kind — the
 * earlier "CF only if BigInt64Array" logic mis-decoded a `<i8` CF array surfaced
 * as a non-BigInt array to 1970-01-01.
 */
function decodeCfOrNsDates(
  d: unknown,
  attrs: Record<string, unknown>,
): string[] | null {
  if (!ArrayBuffer.isView(d) || d instanceof Uint8Array) return null;
  const entries: { v: number; nat: boolean }[] =
    d instanceof BigInt64Array
      ? Array.from(d, (raw) => ({ v: Number(raw), nat: raw === DATETIME64_NAT }))
      : Array.from(d as unknown as ArrayLike<number>, (raw) => ({
          v: Number(raw),
          nat: !Number.isFinite(Number(raw)),
        }));

  const units = typeof attrs.units === "string" ? attrs.units : "";
  const cf = units.match(
    /^(days|hours|minutes|seconds|milliseconds|microseconds|nanoseconds) since (\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?/i,
  );

  const toIso = (ms: number, nat: boolean): string => {
    if (nat || !Number.isFinite(ms)) return "";
    const dt = new Date(ms);
    return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : "";
  };

  if (cf) {
    const unitMs = _CF_UNIT_MS[cf[1].toLowerCase()] ?? 86_400_000;
    const baseMs = Date.parse(`${cf[2]}T${cf[3] ?? "00:00:00"}Z`);
    if (!Number.isFinite(baseMs)) return null;
    return entries.map(({ v, nat }) => toIso(baseMs + v * unitMs, nat || !Number.isFinite(v)));
  }
  // no CF units → assume int64 nanoseconds since epoch
  return entries.map(({ v, nat }) => toIso(v / 1_000_000, nat || !Number.isFinite(v)));
}

/** Read a 1-D datetime variable (`teo`, `availability_date`, …) as ISO date strings. */
async function readDatetimeVarStrings(
  grp: Group<Readable>,
  varName: string,
): Promise<string[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    return decodeCfOrNsDates(ch?.data, (arr.attrs ?? {}) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function readTeoStrings(
  grp: Group<Readable>,
): Promise<string[] | null> {
  return readDatetimeVarStrings(grp, "teo");
}

async function readFloatSlice1d(
  grp: Group<Readable>,
  varName: string,
  t0: number,
  t1: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(t0, t1)]);
    const d = ch?.data;
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    if (d instanceof Int32Array || d instanceof Int16Array) {
      return Array.from(d, (x) => x);
    }
    if (d instanceof BigInt64Array) {
      return Array.from(d, (v) => Number(v));
    }
    return null;
  } catch (err) {
    // A variable genuinely absent from this store (older writer versions)
    // reads as null and its column stays null. Anything else is a transport
    // failure — rethrow so the request fails instead of building (and
    // caching) a null-filled series; withZarrCache caches nothing on throw.
    if (err instanceof NodeNotFoundError || err instanceof KeyError) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/** One row of the per-fund portfolio time series — keys mirror the zarr data_vars. */
export interface FundPortfolioRow {
  teo: string;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  /** v4 cascade (D.8.38): size+value style increment, diagnostic. */
  portfolio_style_return: number | null;
  /** v4 cascade (D.8.38): stock-specific residual, net of style. */
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
}

export interface FundPortfolioOptions {
  /** Inclusive lower bound, YYYY-MM-DD. Trims teos before this date. */
  startDate?: string;
  /** Inclusive upper bound, YYYY-MM-DD. Trims teos after this date. */
  endDate?: string;
}

const PORTFOLIO_VARS = [
  "portfolio_gross_return",
  "portfolio_market_return",
  "portfolio_sector_return",
  "portfolio_subsector_return",
  "portfolio_style_return",
  "portfolio_idiosyncratic_return",
  "identity_residual",
  "weight_sum",
  "n_holdings_active",
  "effective_n",
  "top10_weight_sum",
] as const;

/**
 * Read the per-fund portfolio time series from GCS.
 * Returns [] when the fund has no zarr or no overlap with the date window.
 */
function cacheKeyForFundPortfolioSeries(
  bwFundId: string,
  options: FundPortfolioOptions,
  dataset: string,
): string {
  return generateCacheKey("funds_zarr", `fund_portfolio:${dataset}`, {
    fund: bwFundId,
    start: options.startDate ?? "",
    end: options.endDate ?? "",
  });
}

export async function readFundPortfolioSeries(
  bwFundId: string,
  options: FundPortfolioOptions = {},
  dataset = "ds_portfolio.zarr",
): Promise<FundPortfolioRow[]> {
  const ck = cacheKeyForFundPortfolioSeries(bwFundId, options, dataset);
  return withZarrCache(
    ck,
    () => computeFundPortfolioSeries(bwFundId, options, dataset),
    { emptyValue: [] },
  );
}

async function computeFundPortfolioSeries(
  bwFundId: string,
  options: FundPortfolioOptions,
  dataset: string,
): Promise<FundPortfolioRow[]> {
  const grp = await openFundZarrGroup(bwFundId, dataset);
  if (!grp) return [];

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return [];

  // Apply inclusive date range. Teos are sorted month-ends (YYYY-MM-DD).
  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) {
    while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  }
  if (options.endDate) {
    while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  }
  if (t0 >= t1) return [];

  // Read each var's [t0, t1) slice in parallel. Per-fund ds_portfolio.zarr is
  // tiny (one chunk per var, T ≤ ~250), so this is one chunk fetch per var.
  const series = await Promise.all(
    PORTFOLIO_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSlice1d(grp, varName, t0, t1),
    })),
  );

  const rows: FundPortfolioRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: Record<string, unknown> = { teo: teos[t0 + i]! };
    for (const s of series) {
      row[s.name] = s.data?.[i] ?? null;
    }
    rows.push(row as unknown as FundPortfolioRow);
  }
  return rows;
}

/**
 * Daily-resolution portfolio decomposition — same layout/vars as the monthly
 * series but from `ds_portfolio_daily.zarr` (Funds_DAG). Powers the native
 * cumulative strip at a smooth resolution; kept separate from the monthly
 * `portfolio_history` so the period-window attribution (which counts rows)
 * stays month-based.
 *
 * Thin pass-through — `readFundPortfolioSeries` already caches per-`dataset`,
 * so this dataset variant is covered by that same cache without a second
 * caching layer here.
 */
export function readFundPortfolioDailySeries(
  bwFundId: string,
  options: FundPortfolioOptions = {},
): Promise<FundPortfolioRow[]> {
  return readFundPortfolioSeries(bwFundId, options, "ds_portfolio_daily.zarr");
}

// ---------------------------------------------------------------------------
// NAV — ds_nav.zarr (per-fund yfinance NAV time series)
//
// Layout: coords (teo,); data_vars nav_close (teo,) and nav_return_monthly
// (teo,). Produced by Funds_DAG's fund_nav_zarr v3 asset, which pulls daily
// NAV by ticker_primary and resamples to month-end. Replaces the legacy
// step_1b factset_fund_id-keyed multi-fund yf_nav_returns zarr at the API // licensed-id-ok: comment names a legacy upstream key that this layer replaces; no FactSet ID exposed
// surface — the API only ever sees bw_fund_id-keyed per-fund layouts.
// ---------------------------------------------------------------------------

export interface FundNavRow {
  teo: string;
  nav_close: number | null;
  nav_return_monthly: number | null;
}

const NAV_VARS = ["nav_close", "nav_return_monthly"] as const;

/**
 * Read the per-fund NAV time series from GCS.
 * Returns [] when the fund has no zarr or no overlap with the date window.
 */
export async function readFundNavSeries(
  bwFundId: string,
  options: FundPortfolioOptions = {},
): Promise<FundNavRow[]> {
  const ck = generateCacheKey("funds_zarr", "fund_nav", {
    fund: bwFundId,
    start: options.startDate ?? "",
    end: options.endDate ?? "",
  });
  return withZarrCache(ck, () => computeFundNavSeries(bwFundId, options), {
    emptyValue: [],
  });
}

async function computeFundNavSeries(
  bwFundId: string,
  options: FundPortfolioOptions,
): Promise<FundNavRow[]> {
  const grp = await openFundZarrGroup(bwFundId, "ds_nav.zarr");
  if (!grp) return [];

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return [];

  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) {
    while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  }
  if (options.endDate) {
    while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  }
  if (t0 >= t1) return [];

  const series = await Promise.all(
    NAV_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSlice1d(grp, varName, t0, t1),
    })),
  );

  const rows: FundNavRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: Record<string, unknown> = { teo: teos[t0 + i]! };
    for (const s of series) {
      row[s.name] = s.data?.[i] ?? null;
    }
    rows.push(row as unknown as FundNavRow);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Holdings — ds_ph.zarr (Slice 5)
//
// Layout: coords (symbol = bw_sym_id, teo); data_vars adj_mv (symbol, teo),
// has_new_data (symbol, teo), aum_reported (teo,), aum_erm3 (teo,).
// We surface top-N at the latest teo only — full panel stays GCS-only.
// ---------------------------------------------------------------------------

async function readSymbolStrings(
  grp: Group<Readable>,
): Promise<string[] | null> {
  try {
    const loc = grp.resolve("symbol");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      const out: string[] = [];
      for (let i = 0; i < d.length; i++) out.push(String(d.get(i)).trim());
      return out;
    }
    if (Array.isArray(d)) {
      return d.map((v) => String(v).trim());
    }
    return null;
  } catch {
    return null;
  }
}

/** Read all symbols at a single teo for a (symbol, teo) float var. */
async function readFloatAtTeo(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbols: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(0, nSymbols), teoIdx]);
    const d = ch?.data;
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch {
    return null;
  }
}

/** Read a single scalar from a 1-D (teo,) variable via a length-1 slice. */
async function readScalarAtTeo(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
): Promise<number | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(teoIdx, teoIdx + 1)]);
    const d = ch?.data;
    if (d instanceof Float32Array || d instanceof Float64Array) {
      const v = d[0];
      return v != null && Number.isFinite(v) ? v : null;
    }
    return null;
  } catch {
    return null;
  }
}

export interface FundHolding {
  bw_sym_id: string;
  adj_mv: number;
  /** Fraction of `aum_erm3` (post-universe-filter denominator). Null when AUM is null/0. */
  weight: number | null;
  // Read-time enrichment (enrich-fund-holdings.ts) — best-effort joins from
  // security_history_latest (L3 ER) + symbols (display labels). Absent on a miss.
  ticker?: string | null;
  name?: string | null;
  l3_market_er?: number | null;
  l3_sector_er?: number | null;
  l3_subsector_er?: number | null;
  l3_residual_er?: number | null;
}

export interface FundHoldingsSnapshot {
  teo: string;
  aum_reported: number | null;
  aum_erm3: number | null;
  n_holdings_returned: number;
  n_total_holdings: number;
  holdings: FundHolding[];
}

/**
 * Top-N current holdings at the latest teo for a fund. Default n=25.
 * Returns null when the fund has no zarr or no positive holdings.
 */
export async function readFundHoldingsTopN(
  bwFundId: string,
  n = 25,
): Promise<FundHoldingsSnapshot | null> {
  // Source: the pre-computed `fund_holdings_top` Supabase table (top-25/fund,
  // `weight` = adj_mv/aum_erm3 already computed, ordered by `rank`). No zarr
  // read / no request-time compute. l3_*_er + ticker are joined separately at
  // read-time by enrich-fund-holdings.ts (l3 refreshes daily, holdings quarterly).
  const safeN = Math.min(Math.max(n, 1), 1000);
  const ck = generateCacheKey("funds_zarr", "fund_holdings_top", {
    fund: bwFundId,
    n: safeN,
  });
  // The Funds_DAG sync writer bursts upserts over ~25s; a request landing
  // mid-burst can see rows mixing report periods. Serve only the rank-1
  // period's rows and veto the cache write so the next request re-reads a
  // settled table instead of pinning the torn snapshot for the full TTL.
  let torn = false;
  const snapshot = await withZarrCache<FundHoldingsSnapshot | null>(
    ck,
    async () => {
      const admin = createAdminClient();
      const { data: rows, error } = await admin
        .from("fund_holdings_top")
        .select(
          "symbol, rank, weight, market_value_usd, n_holdings_total, report_date",
        )
        .eq("bw_fund_id", bwFundId)
        .order("rank", { ascending: true })
        .limit(safeN);
      if (error || !rows || rows.length === 0) return null;

      const first = rows[0]!;
      const teo = String(first.report_date);
      torn = rows.some((r) => String(r.report_date) !== teo);
      const coherent = torn
        ? rows.filter((r) => String(r.report_date) === teo)
        : rows;
      const nTotal = Number(first.n_holdings_total ?? coherent.length);
      const holdings: FundHolding[] = coherent.map((r) => ({
        bw_sym_id: String(r.symbol),
        adj_mv: Number(r.market_value_usd) || 0,
        weight: r.weight != null ? Number(r.weight) : null,
      }));

      return {
        teo,
        // aum lives on funds_latest (used for metrics); holdings weights are
        // pre-computed, so the snapshot doesn't need aum echoed here.
        aum_reported: null,
        aum_erm3: null,
        n_holdings_returned: holdings.length,
        n_total_holdings: nTotal,
        holdings,
      };
    },
    { emptyValue: null, cacheable: () => !torn },
  );
  if (!snapshot) return null;
  // Scrub outside the cache boundary: a transiently degraded scrub (Supabase
  // blip → BW-RESTRICTED fallback) then affects one response, not the cached
  // copy, and newly resolved ids propagate on the next request.
  return {
    ...snapshot,
    holdings: await applyScrubToHoldings(snapshot.holdings),
  };
}

// ---------------------------------------------------------------------------
// Hedge ratios — ds_hr.zarr (Slice 7)
//
// Layout: coords (teo, symbol = ETF symbol); data_vars L1_HR / L2_HR / L3_HR
// each (teo, symbol). Many entries are NaN (an ETF only has a non-NaN HR
// at the level where it's the matched factor ETF). At the latest teo we
// return per-level lists of { etf, hr } dropping NaN entries.
// ---------------------------------------------------------------------------

/** Read all symbols at one teo from a (teo, symbol) float var. */
async function readFloatRowAtTeo(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbols: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nSymbols)]);
    const d = ch?.data;
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch (err) {
    // Missing hedge-level var → empty leg (expected for sparse ds_hr);
    // transport failure → rethrow so a truncated snapshot is never cached.
    if (err instanceof NodeNotFoundError || err instanceof KeyError) {
      return null;
    }
    throw err;
  }
}

export interface HedgeLeg {
  etf: string;
  hr: number;
}

export interface FundHedgeSnapshot {
  teo: string;
  L1: HedgeLeg[];
  L2: HedgeLeg[];
  L3: HedgeLeg[];
}

/**
 * Latest L1/L2/L3 hedge ratios for a fund. Returns null when the per-fund
 * `ds_hr.zarr` is missing or empty.
 */
export async function readFundHedgeLatest(
  bwFundId: string,
): Promise<FundHedgeSnapshot | null> {
  const ck = generateCacheKey("funds_zarr", "fund_hedge_latest", { fund: bwFundId });
  return withZarrCache(ck, () => computeFundHedgeLatest(bwFundId), {
    emptyValue: null,
  });
}

async function computeFundHedgeLatest(
  bwFundId: string,
): Promise<FundHedgeSnapshot | null> {
  const grp = await openFundZarrGroup(bwFundId, "ds_hr.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;

  const [l1, l2, l3] = await Promise.all([
    readFloatRowAtTeo(grp, "L1_HR", teoIdx, symbols.length),
    readFloatRowAtTeo(grp, "L2_HR", teoIdx, symbols.length),
    readFloatRowAtTeo(grp, "L3_HR", teoIdx, symbols.length),
  ]);

  const symbolNames = symbols;
  function pack(row: (number | null)[] | null): HedgeLeg[] {
    if (!row) return [];
    const legs: HedgeLeg[] = [];
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v != null) legs.push({ etf: symbolNames[i]!, hr: v });
    }
    return legs;
  }

  const out: FundHedgeSnapshot = {
    teo,
    L1: pack(l1),
    L2: pack(l2),
    L3: pack(l3),
  };
  if (out.L1.length === 0 && out.L2.length === 0 && out.L3.length === 0) {
    return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-cell cohort portfolio — Slice 6 (portfolio_style/{Cell_Name}/ds_portfolio.zarr)
// dims (teo, weighting); weighting = ['ew', 'mv'].
// ---------------------------------------------------------------------------

/** Read coord values for `weighting` (e.g. ["ew","mv"]). */
async function readWeightingCoord(
  grp: Group<Readable>,
): Promise<string[] | null> {
  try {
    const loc = grp.resolve("weighting");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      const out: string[] = [];
      for (let i = 0; i < d.length; i++) out.push(String(d.get(i)).trim());
      return out;
    }
    if (Array.isArray(d)) return d.map((v) => String(v).trim());
    return null;
  } catch {
    return null;
  }
}

/** Read all (teo, weighting) values in [t0, t1) for a (teo, weighting) float var. */
async function readFloatSliceTeoByWeighting(
  grp: Group<Readable>,
  varName: string,
  t0: number,
  t1: number,
  nWeighting: number,
): Promise<(number | null)[][] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(t0, t1), slice(0, nWeighting)]);
    const d = ch?.data;
    if (!(d instanceof Float32Array || d instanceof Float64Array)) return null;
    const T = t1 - t0;
    const out: (number | null)[][] = [];
    for (let i = 0; i < T; i++) {
      const row: (number | null)[] = [];
      for (let w = 0; w < nWeighting; w++) {
        const v = d[i * nWeighting + w];
        row.push(v != null && Number.isFinite(v) ? v : null);
      }
      out.push(row);
    }
    return out;
  } catch {
    return null;
  }
}

const COHORT_PORTFOLIO_VARS = [
  "portfolio_gross_return",
  "portfolio_market_return",
  "portfolio_sector_return",
  "portfolio_subsector_return",
  "portfolio_style_return",
  "portfolio_idiosyncratic_return",
  "identity_residual",
  "weight_sum",
  "n_holdings_active",
  "effective_n",
  "top10_weight_sum",
] as const;

export type CohortPortfolioVarName = (typeof COHORT_PORTFOLIO_VARS)[number];

export interface CohortPortfolioRowPerWeighting {
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_style_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
}

export interface CohortPortfolioRow {
  teo: string;
  ew: CohortPortfolioRowPerWeighting | null;
  mv: CohortPortfolioRowPerWeighting | null;
}

export interface CohortPortfolioOptions {
  startDate?: string;
  endDate?: string;
}

/**
 * Per-cell cohort portfolio time series. Returns rows per teo with both
 * EW + MV blocks side-by-side.
 */
export async function readStyleCohortPortfolioSeries(
  pathComponent: string,
  options: CohortPortfolioOptions = {},
): Promise<CohortPortfolioRow[]> {
  const ck = generateCacheKey("funds_zarr", "style_cohort_portfolio", {
    cell: pathComponent,
    start: options.startDate ?? "",
    end: options.endDate ?? "",
  });
  return withZarrCache(
    ck,
    () => computeStyleCohortPortfolioSeries(pathComponent, options),
    { emptyValue: [] },
  );
}

async function computeStyleCohortPortfolioSeries(
  pathComponent: string,
  options: CohortPortfolioOptions,
): Promise<CohortPortfolioRow[]> {
  const grp = await openCohortZarrGroup(
    "portfolio_style",
    pathComponent,
    "ds_portfolio.zarr",
  );
  if (!grp) return [];

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return [];

  const weightings = await readWeightingCoord(grp);
  if (!weightings || weightings.length === 0) return [];

  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) {
    while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  }
  if (options.endDate) {
    while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  }
  if (t0 >= t1) return [];

  const series = await Promise.all(
    COHORT_PORTFOLIO_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSliceTeoByWeighting(
        grp,
        varName,
        t0,
        t1,
        weightings.length,
      ),
    })),
  );

  const rows: CohortPortfolioRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: CohortPortfolioRow = {
      teo: teos[t0 + i]!,
      ew: null,
      mv: null,
    };
    for (let w = 0; w < weightings.length; w++) {
      const wKey = weightings[w]!.toLowerCase();
      if (wKey !== "ew" && wKey !== "mv") continue;
      const block: Record<string, number | null> = {};
      for (const s of series) {
        block[s.name] = s.data?.[i]?.[w] ?? null;
      }
      row[wKey as "ew" | "mv"] = block as unknown as CohortPortfolioRowPerWeighting;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Per-cell cohort holdings — Slice 5b (equity_style_9box/{Cell_Name}/ds_symbols.zarr)
// dims (teo, symbol, weighting) for weight + contribution_*; (teo, symbol)
// for n_funds_holding. Top-N at latest teo for one weighting.
// ---------------------------------------------------------------------------

/** Read a single (teoIdx, *, weightingIdx) slice from a (teo, symbol, weighting) float var. */
async function readFloat3dSlice(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbols: number,
  weightingIdx: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nSymbols), weightingIdx]);
    const d = ch?.data;
    if (!(d instanceof Float32Array || d instanceof Float64Array)) return null;
    return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
  } catch {
    return null;
  }
}

/** Read all symbols at one teo for a (teo, symbol) integer var (e.g. n_funds_holding). */
async function readIntRowAtTeoSymbol(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbols: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nSymbols)]);
    const d = ch?.data;
    if (
      d instanceof Int32Array ||
      d instanceof Int16Array ||
      d instanceof Float32Array ||
      d instanceof Float64Array
    ) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch {
    return null;
  }
}

export interface CohortHolding {
  bw_sym_id: string;
  weight: number;
  contribution_gross: number | null;
  contribution_market: number | null;
  contribution_sector: number | null;
  contribution_subsector: number | null;
  contribution_idiosyncratic: number | null;
  n_funds_holding: number | null;
}

export interface CohortHoldingsSnapshot {
  teo: string;
  weighting: "ew" | "mv";
  n_returned: number;
  n_total_holdings: number;
  holdings: CohortHolding[];
}

/**
 * Top-N cohort holdings at the latest teo for the chosen weighting. Sorted
 * by `weight` descending. Returns null when the per-cell zarr is missing
 * or the requested weighting isn't present.
 */
export async function readStyleCohortHoldingsTopN(
  pathComponent: string,
  options: { weighting?: "ew" | "mv"; n?: number } = {},
): Promise<CohortHoldingsSnapshot | null> {
  const requestedWeighting = options.weighting ?? "mv";
  const n = options.n ?? 25;
  const safeN = Math.min(Math.max(n, 1), 100);

  const ck = generateCacheKey("funds_zarr", "style_cohort_holdings_top", {
    cell: pathComponent,
    weighting: requestedWeighting,
    n: safeN,
  });
  const snapshot = await withZarrCache(
    ck,
    () => computeStyleCohortHoldingsTopN(pathComponent, requestedWeighting, safeN),
    { emptyValue: null },
  );
  if (!snapshot) return null;
  // Scrub outside the cache boundary — see readFundHoldingsTopN.
  return {
    ...snapshot,
    holdings: await applyScrubToHoldings(snapshot.holdings),
  };
}

async function computeStyleCohortHoldingsTopN(
  pathComponent: string,
  requestedWeighting: "ew" | "mv",
  safeN: number,
): Promise<CohortHoldingsSnapshot | null> {
  const grp = await openCohortZarrGroup(
    "equity_style_9box",
    pathComponent,
    "ds_symbols.zarr",
  );
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;
  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;
  const weightings = await readWeightingCoord(grp);
  if (!weightings || weightings.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;
  const wIdx = weightings.findIndex((w) => w.toLowerCase() === requestedWeighting);
  if (wIdx < 0) return null;

  const [
    weightVec,
    contribGross,
    contribMarket,
    contribSector,
    contribSubsector,
    contribIdio,
    nFundsHolding,
  ] = await Promise.all([
    readFloat3dSlice(grp, "weight", teoIdx, symbols.length, wIdx),
    readFloat3dSlice(grp, "contribution_gross", teoIdx, symbols.length, wIdx),
    readFloat3dSlice(grp, "contribution_market", teoIdx, symbols.length, wIdx),
    readFloat3dSlice(grp, "contribution_sector", teoIdx, symbols.length, wIdx),
    readFloat3dSlice(grp, "contribution_subsector", teoIdx, symbols.length, wIdx),
    readFloat3dSlice(grp, "contribution_idiosyncratic", teoIdx, symbols.length, wIdx),
    readIntRowAtTeoSymbol(grp, "n_funds_holding", teoIdx, symbols.length),
  ]);
  if (!weightVec) return null;

  const all: CohortHolding[] = [];
  for (let i = 0; i < weightVec.length; i++) {
    const w = weightVec[i];
    if (w != null && w > 0) {
      all.push({
        bw_sym_id: symbols[i]!,
        weight: w,
        contribution_gross: contribGross?.[i] ?? null,
        contribution_market: contribMarket?.[i] ?? null,
        contribution_sector: contribSector?.[i] ?? null,
        contribution_subsector: contribSubsector?.[i] ?? null,
        contribution_idiosyncratic: contribIdio?.[i] ?? null,
        n_funds_holding: nFundsHolding?.[i] ?? null,
      });
    }
  }
  if (all.length === 0) return null;

  all.sort((a, b) => b.weight - a.weight);
  const top = all.slice(0, safeN);

  return {
    teo,
    weighting: requestedWeighting,
    n_returned: Math.min(safeN, all.length),
    n_total_holdings: all.length,
    holdings: top,
  };
}

// ===========================================================================
// 13F FILER READERS (D.8 Phase 1)
//
// Per-filer stores live under bw_filer_id/{BW-FILER-CIK...}/ — same internal
// helpers, different path prefix. Phase 1 schemas:
//
//   ds_ph.zarr        coords (symbol = bw_sym_id post-D.8.1, teo);
//                     data_vars adj_mv (symbol, teo). Pre-D.8.1 the symbol
//                     coord is a raw 9-char security id — readers tolerate
//                     either by treating the coord as opaque string ids and
//                     surfacing them under `security_id`.
//   ds_portfolio.zarr dim (teo,); diagnostics + AUM + portfolio style
//                     attribution columns. Return components (Phase 2)
//                     are absent for filers today and read as null.
// ===========================================================================

export interface FilerHolding {
  /**
   * Opaque security id from the zarr's `symbol` coord. Post-D.8.1 this is
   * a `bw_sym_id` (FIGI namespace, `BW-{eodhd_code}`). Pre-migration this
   * may be a raw 9-char security identifier — surfaced as-is so consumers
   * can detect the transition by string shape (`BW-` prefix vs digits).
   */
  security_id: string;
  adj_mv: number;
  /** Fraction of total in-portfolio AUM at this teo. Null when AUM is null/0. */
  weight: number | null;
  /** Display ticker when enriched from Supabase `symbols` / registry (optional). */
  ticker?: string | null;
  /** Company name when enriched from Supabase `symbols` / registry (optional). */
  name?: string | null;
  /** Latest daily L3 explained-risk shares from `security_history_latest` (optional). */
  l3_market_er?: number | null;
  l3_sector_er?: number | null;
  l3_subsector_er?: number | null;
  l3_residual_er?: number | null;
}

export interface FilerHoldingsSnapshot {
  teo: string;
  /** Valid-time stamp (D.8.39): the 13F reporting period end. Equal to `teo`. */
  report_date: string;
  /**
   * Knowledge-time stamp (D.8.39): EDGAR date_filed of the surviving
   * (latest-filed) submission for this report_date. Null on pre-1.4-schema
   * zarrs that don't carry the `filing_date` var yet.
   */
  filing_date: string | null;
  /**
   * Which time axis resolved an `as_of` selection: `filing_date` (knowledge
   * mode — what was public by that date) or `report_date` (fallback when the
   * zarr has no filing_date var; overstates what was knowable by up to the
   * statutory 13F lag).
   */
  as_of_basis: "filing_date" | "report_date";
  total_aum_usd: number | null;
  /** Sum of `adj_mv` over the in-ERM3 mapped subset; null pre-D.8.1. */
  aum_in_erm3: number | null;
  n_holdings_returned: number;
  n_total_holdings: number;
  holdings: FilerHolding[];
}

/**
 * Top-N holdings for a 13F filer. Default n=25 at the latest teo. With
 * `asOf`, selects the latest quarter *known* by that date — filing_date <=
 * asOf when the zarr carries per-teo filing dates, else report_date <= asOf
 * (the basis used is surfaced on the snapshot). Returns null when the filer
 * has no zarr, no positive holdings, or nothing was known by `asOf`.
 *
 * Symmetric to `readFundHoldingsTopN` but reads `bw_filer_id/...` and
 * surfaces the security id under `security_id` (since pre-D.8.1 it may be
 * a raw security id rather than bw_sym_id).
 */
export async function readFilerHoldingsTopN(
  bwFilerId: string,
  n = 25,
  asOf?: string,
): Promise<FilerHoldingsSnapshot | null> {
  const safeN = Math.min(Math.max(n, 1), 1000);
  const ck = generateCacheKey("funds_zarr", "filer_holdings_top", {
    filer: bwFilerId,
    n: safeN,
    as_of: asOf ?? "",
    v: 2, // D.8.39 snapshot shape (report_date/filing_date/as_of_basis)
  });
  const snapshot = await withZarrCache(
    ck,
    () => computeFilerHoldingsTopN(bwFilerId, safeN, asOf),
    { emptyValue: null },
  );
  if (!snapshot) return null;
  // Scrub outside the cache boundary — see readFundHoldingsTopN.
  return {
    ...snapshot,
    holdings: await applyScrubToFilerHoldings(snapshot.holdings),
  };
}

async function computeFilerHoldingsTopN(
  bwFilerId: string,
  safeN: number,
  asOf?: string,
): Promise<FilerHoldingsSnapshot | null> {
  const grp = await openFilerZarrGroup(bwFilerId, "ds_ph.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  // D.8.39: per-teo knowledge-time stamps. Absent on pre-1.4-schema zarrs.
  const filingDates = await readDatetimeVarStrings(grp, "filing_date");
  const asOfBasis: FilerHoldingsSnapshot["as_of_basis"] = filingDates
    ? "filing_date"
    : "report_date";

  let teoIdx = teos.length - 1;
  if (asOf) {
    // Latest quarter known by `asOf`: walk back from the newest teo so an
    // out-of-order amendment date on an older quarter can't shadow a
    // regularly-filed newer one.
    teoIdx = -1;
    for (let i = teos.length - 1; i >= 0; i--) {
      const known = filingDates ? filingDates[i] : teos[i];
      if (known != null && known <= asOf) {
        teoIdx = i;
        break;
      }
    }
    if (teoIdx < 0) return null;
  }
  const teo = teos[teoIdx]!;

  // total_aum_usd may not exist on filer ds_ph — readScalarAtTeo returns null on missing var.
  const [adjMv, totalAumUsd, aumInErm3] = await Promise.all([
    readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length),
    readScalarAtTeo(grp, "total_aum_usd", teoIdx),
    readScalarAtTeo(grp, "aum_in_erm3", teoIdx),
  ]);
  if (!adjMv) return null;

  let denom = totalAumUsd != null && totalAumUsd > 0 ? totalAumUsd : null;
  if (denom == null) {
    let sumAdj = 0;
    for (const v of adjMv) {
      if (v != null && v > 0) sumAdj += v;
    }
    denom = sumAdj > 0 ? sumAdj : null;
  }
  const holdings: FilerHolding[] = [];
  for (let i = 0; i < adjMv.length; i++) {
    const v = adjMv[i];
    if (v != null && v > 0) {
      holdings.push({
        security_id: symbols[i]!,
        adj_mv: v,
        weight: denom != null ? v / denom : null,
      });
    }
  }
  if (holdings.length === 0) return null;

  holdings.sort((a, b) => b.adj_mv - a.adj_mv);
  const top = holdings.slice(0, safeN);

  return {
    teo,
    report_date: teo,
    filing_date: filingDates?.[teoIdx] ?? null,
    as_of_basis: asOfBasis,
    total_aum_usd: totalAumUsd,
    aum_in_erm3: aumInErm3,
    n_holdings_returned: Math.min(safeN, holdings.length),
    n_total_holdings: holdings.length,
    holdings: top,
  };
}

/**
 * One row of the per-filer portfolio time series. Phase 1 emits only
 * diagnostics + AUM + (post-kernel) style-attribution metrics. Return
 * components are NULL for filers until Phase 2 lands.
 */
export interface FilerPortfolioRow {
  teo: string;
  /**
   * Knowledge-time stamp (D.8.39): EDGAR date_filed of the surviving
   * submission for this quarter. Null on pre-1.4-schema zarrs.
   */
  filing_date: string | null;
  // Diagnostics (parallel to fund-side)
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top5_weight_sum: number | null;
  top10_weight_sum: number | null;
  weight_hhi: number | null;
  // AUM
  total_aum_usd: number | null;
  aum_in_erm3: number | null;
  // ERM3-coverage modelability inputs (post D.8.3 kernel)
  n_holdings_in_erm3: number | null;
  effective_n_in_erm3: number | null;
  coverage_in_erm3: number | null;
  // Portfolio style attribution (post D.8.3 kernel)
  portfolio_style_hhi: number | null;
  effective_n_styles: number | null;
  // Phase 2 return components — NULL on filer side until bridge attribution lands
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
}

const FILER_PORTFOLIO_VARS = [
  "weight_sum",
  "n_holdings_active",
  "effective_n",
  "top5_weight_sum",
  "top10_weight_sum",
  "weight_hhi",
  "total_aum_usd",
  "aum_in_erm3",
  "n_holdings_in_erm3",
  "effective_n_in_erm3",
  "coverage_in_erm3",
  "portfolio_style_hhi",
  "effective_n_styles",
  "portfolio_gross_return",
  "portfolio_market_return",
  "portfolio_sector_return",
  "portfolio_subsector_return",
  "portfolio_idiosyncratic_return",
  "identity_residual",
] as const;

/**
 * Read the per-filer portfolio time series from GCS. Returns [] when the
 * filer has no zarr or no overlap with the date window. Variables not yet
 * emitted by the writer (e.g. style attribution pre-D.8.3, returns pre-
 * Phase 2) read as null per row.
 */
export async function readFilerPortfolioSeries(
  bwFilerId: string,
  options: FundPortfolioOptions = {},
): Promise<FilerPortfolioRow[]> {
  const ck = generateCacheKey("funds_zarr", "filer_portfolio", {
    filer: bwFilerId,
    start: options.startDate ?? "",
    end: options.endDate ?? "",
    v: 2, // D.8.39 row shape (filing_date)
  });
  return withZarrCache(ck, () => computeFilerPortfolioSeries(bwFilerId, options), {
    emptyValue: [],
  });
}

async function computeFilerPortfolioSeries(
  bwFilerId: string,
  options: FundPortfolioOptions,
): Promise<FilerPortfolioRow[]> {
  const grp = await openFilerZarrGroup(bwFilerId, "ds_portfolio.zarr");
  if (!grp) return [];

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return [];

  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) {
    while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  }
  if (options.endDate) {
    while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  }
  if (t0 >= t1) return [];

  const [series, filingDates] = await Promise.all([
    Promise.all(
      FILER_PORTFOLIO_VARS.map(async (varName) => ({
        name: varName,
        data: await readFloatSlice1d(grp, varName, t0, t1),
      })),
    ),
    // D.8.39: per-teo knowledge-time stamps. Absent on pre-1.4-schema zarrs.
    readDatetimeVarStrings(grp, "filing_date"),
  ]);

  const rows: FilerPortfolioRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: Record<string, unknown> = {
      teo: teos[t0 + i]!,
      filing_date: filingDates?.[t0 + i] ?? null,
    };
    for (const s of series) {
      row[s.name] = s.data?.[i] ?? null;
    }
    rows.push(row as unknown as FilerPortfolioRow);
  }
  return rows;
}

function medianFinite(values: Array<number | null>): number | null {
  const nums = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid]!;
  return (nums[mid - 1]! + nums[mid]!) / 2;
}

export interface FilerConcentrationLatest {
  teo: string;
  effective_n: number | null;
  top5_weight_sum: number | null;
  top10_weight_sum: number | null;
  weight_hhi: number | null;
  n_holdings_active: number | null;
}

export interface FilerConcentrationSummary {
  n_periods: number;
  start_teo: string;
  end_teo: string;
  latest: FilerConcentrationLatest;
  median: {
    effective_n: number | null;
    top5_weight_sum: number | null;
    top10_weight_sum: number | null;
    weight_hhi: number | null;
  };
}

/**
 * Median + latest quarter-end concentration from ``ds_portfolio.zarr``.
 * Null when the filer has no portfolio panel in the date window.
 *
 * Not independently cached: it's a cheap in-memory median/reduce over
 * `readFilerPortfolioSeries`, which is already Redis-cached — a second
 * cache layer here would just add a redundant Redis round-trip for no
 * additional GCS savings.
 */
export async function readFilerConcentrationSummary(
  bwFilerId: string,
  options: FundPortfolioOptions = {},
): Promise<FilerConcentrationSummary | null> {
  const rows = await readFilerPortfolioSeries(bwFilerId, options);
  if (rows.length === 0) return null;

  const latest = rows[rows.length - 1]!;
  return {
    n_periods: rows.length,
    start_teo: rows[0]!.teo,
    end_teo: latest.teo,
    latest: {
      teo: latest.teo,
      effective_n: latest.effective_n,
      top5_weight_sum: latest.top5_weight_sum,
      top10_weight_sum: latest.top10_weight_sum,
      weight_hhi: latest.weight_hhi,
      n_holdings_active: latest.n_holdings_active,
    },
    median: {
      effective_n: medianFinite(rows.map((r) => r.effective_n)),
      top5_weight_sum: medianFinite(rows.map((r) => r.top5_weight_sum)),
      top10_weight_sum: medianFinite(rows.map((r) => r.top10_weight_sum)),
      weight_hhi: medianFinite(rows.map((r) => r.weight_hhi)),
    },
  };
}

const FILER_RETURNS_VARS = [
  "portfolio_gross_return",
  "portfolio_market_return",
  "portfolio_sector_return",
  "portfolio_subsector_return",
  "portfolio_style_return",
  "portfolio_idiosyncratic_return",
] as const;

/** One monthly row from filer ``ds_returns_monthly.zarr`` (D.8.22, v4 cascade D.8.38). */
export interface FilerMonthlyReturnRow {
  teo: string;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  /** v4 cascade (D.8.38): size+value style increment, diagnostic. */
  portfolio_style_return: number | null;
  /** v4 cascade (D.8.38): stock-specific residual, net of style. */
  portfolio_idiosyncratic_return: number | null;
}

export interface FilerVarianceSharesBlock {
  market: number | null;
  sector: number | null;
  subsector: number | null;
  /** v4 cascade (D.8.38): size+value style variance share. */
  style: number | null;
  residual: number | null;
}

export interface FilerReturnsDecomposition {
  n_periods: number;
  rows: FilerMonthlyReturnRow[];
  variance_shares_full: FilerVarianceSharesBlock | null;
  variance_shares_recent: FilerVarianceSharesBlock | null;
  waterfall_latest_month: Partial<
    Record<
      | "portfolio_gross_return"
      | "portfolio_market_return"
      | "portfolio_sector_return"
      | "portfolio_subsector_return"
      | "portfolio_style_return"
      | "portfolio_idiosyncratic_return",
      number
    >
  > | null;
}

function filerVarianceSharesFromAttrs(attrs: Record<string, unknown>): {
  full: FilerVarianceSharesBlock | null;
  recent: FilerVarianceSharesBlock | null;
} {
  const num = (k: string): number | null => {
    const v = attrs[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const full: FilerVarianceSharesBlock = {
    market: num("adjusted_l1_market_er"),
    sector: num("adjusted_l2_sector_er"),
    subsector: num("adjusted_l3_subsector_er"),
    style: num("adjusted_style_er"),
    residual: num("adjusted_l3_residual_er"),
  };
  const recent: FilerVarianceSharesBlock = {
    market: num("adjusted_recent_l1_market_er"),
    sector: num("adjusted_recent_l2_sector_er"),
    subsector: num("adjusted_recent_l3_subsector_er"),
    style: num("adjusted_recent_style_er"),
    residual: num("adjusted_recent_l3_residual_er"),
  };
  const hasAny = (v: FilerVarianceSharesBlock) =>
    v.market != null || v.sector != null || v.subsector != null ||
    v.style != null || v.residual != null;
  return {
    full: hasAny(full) ? full : null,
    recent: hasAny(recent) ? recent : null,
  };
}

function waterfallLatestFromSlices(
  teos: string[],
  slices: Record<(typeof FILER_RETURNS_VARS)[number], (number | null)[] | null>,
): FilerReturnsDecomposition["waterfall_latest_month"] {
  const n = teos.length;
  if (n === 0) return null;
  let idx: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const g = slices.portfolio_gross_return?.[i];
    if (g != null && Number.isFinite(g)) {
      idx = i;
      break;
    }
  }
  if (idx == null) return null;
  const keys = [
    "portfolio_gross_return",
    "portfolio_market_return",
    "portfolio_sector_return",
    "portfolio_subsector_return",
    "portfolio_style_return",
    "portfolio_idiosyncratic_return",
  ] as const;
  const out: Partial<
    Record<(typeof keys)[number], number>
  > = {};
  for (const k of keys) {
    const v = slices[k]?.[idx];
    if (v != null && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Monthly L3 portfolio decomposition for a filer from ``ds_returns_monthly.zarr``.
 * Null when zarr is missing or the date window is empty.
 */
export async function readFilerReturnsDecomposition(
  bwFilerId: string,
  options: FundPortfolioOptions = {},
): Promise<FilerReturnsDecomposition | null> {
  const ck = generateCacheKey("funds_zarr", "filer_returns_decomposition", {
    filer: bwFilerId,
    start: options.startDate ?? "",
    end: options.endDate ?? "",
  });
  return withZarrCache(
    ck,
    () => computeFilerReturnsDecomposition(bwFilerId, options),
    { emptyValue: null },
  );
}

async function computeFilerReturnsDecomposition(
  bwFilerId: string,
  options: FundPortfolioOptions,
): Promise<FilerReturnsDecomposition | null> {
  const grp = await openFilerZarrGroup(bwFilerId, "ds_returns_monthly.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) {
    while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  }
  if (options.endDate) {
    while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  }
  if (t0 >= t1) return null;

  const series = await Promise.all(
    FILER_RETURNS_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSlice1d(grp, varName, t0, t1),
    })),
  );

  const slices: Record<(typeof FILER_RETURNS_VARS)[number], (number | null)[] | null> = {
    portfolio_gross_return: null,
    portfolio_market_return: null,
    portfolio_sector_return: null,
    portfolio_subsector_return: null,
    portfolio_style_return: null,
    portfolio_idiosyncratic_return: null,
  };
  for (const s of series) {
    if (s.name in slices) {
      slices[s.name as keyof typeof slices] = s.data;
    }
  }

  const trimmedTeos = teos.slice(t0, t1);
  const rows: FilerMonthlyReturnRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    rows.push({
      teo: trimmedTeos[i]!,
      portfolio_gross_return: slices.portfolio_gross_return?.[i] ?? null,
      portfolio_market_return: slices.portfolio_market_return?.[i] ?? null,
      portfolio_sector_return: slices.portfolio_sector_return?.[i] ?? null,
      portfolio_subsector_return: slices.portfolio_subsector_return?.[i] ?? null,
      portfolio_style_return: slices.portfolio_style_return?.[i] ?? null,
      portfolio_idiosyncratic_return: slices.portfolio_idiosyncratic_return?.[i] ?? null,
    });
  }

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const { full, recent } = filerVarianceSharesFromAttrs(attrs);

  return {
    n_periods: rows.length,
    rows,
    variance_shares_full: full,
    variance_shares_recent: recent,
    waterfall_latest_month: waterfallLatestFromSlices(trimmedTeos, slices),
  };
}

/**
 * Latest hedge sleeve for a filer from ``ds_hr.zarr`` (same schema as funds).
 */
export async function readFilerHedgeLatest(
  bwFilerId: string,
): Promise<FundHedgeSnapshot | null> {
  const ck = generateCacheKey("funds_zarr", "filer_hedge_latest", { filer: bwFilerId });
  return withZarrCache(ck, () => computeFilerHedgeLatest(bwFilerId), {
    emptyValue: null,
  });
}

async function computeFilerHedgeLatest(
  bwFilerId: string,
): Promise<FundHedgeSnapshot | null> {
  const grp = await openFilerZarrGroup(bwFilerId, "ds_hr.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;

  const [l1, l2, l3] = await Promise.all([
    readFloatRowAtTeo(grp, "L1_HR", teoIdx, symbols.length),
    readFloatRowAtTeo(grp, "L2_HR", teoIdx, symbols.length),
    readFloatRowAtTeo(grp, "L3_HR", teoIdx, symbols.length),
  ]);

  const symbolNames = symbols;
  function pack(row: (number | null)[] | null): HedgeLeg[] {
    if (!row) return [];
    const legs: HedgeLeg[] = [];
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v != null) legs.push({ etf: symbolNames[i]!, hr: v });
    }
    return legs;
  }

  const out: FundHedgeSnapshot = {
    teo,
    L1: pack(l1),
    L2: pack(l2),
    L3: pack(l3),
  };
  if (out.L1.length === 0 && out.L2.length === 0 && out.L3.length === 0) {
    return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthetic composite entities — bw_synth_id/{BW-SYNTH-*}/ds_ph.zarr
//
// Same holdings schema as filers (coords symbol = bw_sym_id, teo; data_var
// adj_mv) plus self-describing group attrs (recipe JSON, recipe_hash,
// weight_basis, ontology_version, layer_depth) and per-teo composition
// coverage vars. No registry row exists — the zarr is the source of truth.
// ---------------------------------------------------------------------------

/** Composition coverage at one teo — how much of the recipe is materialized. */
export interface SyntheticEntityCoverage {
  mapped_weight_frac: number | null;
  child_coverage: number | null;
  effective_coverage: number | null;
  n_children: number | null;
}

export interface SyntheticEntityMeta {
  /** Latest teo in the holdings panel (YYYY-MM-DD). */
  teo: string;
  /** Display handle from the zarr attrs (`plan_id`). */
  name: string | null;
  /** Parsed `recipe` attr — self-describing composition spec. */
  recipe: Record<string, unknown> | null;
  recipe_hash: string | null;
  weight_basis: string | null;
  ontology_version: string | null;
  layer_depth: number | null;
  /** Coverage vars at the latest teo. */
  coverage: SyntheticEntityCoverage;
}

/**
 * Entity metadata for a synthetic composite, read from its `ds_ph.zarr`
 * group attrs + latest-teo coverage vars. Null when the id is not a
 * synthetic id or the store is missing/empty.
 */
export async function readSyntheticEntityMeta(
  bwSynthId: string,
): Promise<SyntheticEntityMeta | null> {
  if (!isSyntheticEntityId(bwSynthId)) return null;
  const ck = generateCacheKey("funds_zarr", "synth_entity_meta", {
    id: bwSynthId,
  });
  return withZarrCache(ck, () => computeSyntheticEntityMeta(bwSynthId), {
    emptyValue: null,
  });
}

async function computeSyntheticEntityMeta(
  bwSynthId: string,
): Promise<SyntheticEntityMeta | null> {
  const grp = await openFilerZarrGroup(bwSynthId, "ds_ph.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;
  const teoIdx = teos.length - 1;

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof attrs[k] === "string" ? (attrs[k] as string) : null;
  const num = (k: string): number | null =>
    typeof attrs[k] === "number" && Number.isFinite(attrs[k] as number)
      ? (attrs[k] as number)
      : null;

  let recipe: Record<string, unknown> | null = null;
  const rawRecipe = str("recipe");
  if (rawRecipe) {
    try {
      const parsed: unknown = JSON.parse(rawRecipe);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        recipe = parsed as Record<string, unknown>;
      }
    } catch {
      // malformed recipe attr → surface null rather than fail the read
    }
  }

  const [mapped, child, effective, nChildren] = await Promise.all([
    readFloatSlice1d(grp, "mapped_weight_frac", teoIdx, teoIdx + 1),
    readFloatSlice1d(grp, "child_coverage", teoIdx, teoIdx + 1),
    readFloatSlice1d(grp, "effective_coverage", teoIdx, teoIdx + 1),
    readFloatSlice1d(grp, "n_children", teoIdx, teoIdx + 1),
  ]);

  return {
    teo: teos[teoIdx]!,
    name: str("plan_id"),
    recipe,
    recipe_hash: str("recipe_hash"),
    weight_basis: str("weight_basis"),
    ontology_version: str("ontology_version"),
    layer_depth: num("layer_depth"),
    coverage: {
      mapped_weight_frac: mapped?.[0] ?? null,
      child_coverage: child?.[0] ?? null,
      effective_coverage: effective?.[0] ?? null,
      n_children: nChildren?.[0] ?? null,
    },
  };
}

// ===========================================================================
// ETF SPONSOR HOLDINGS READERS (canonical PortfolioSurface, MASTER_BACKLOG L.6 / D.9)
//
// Per-ETF stores live under bw_etf_id/{BW-ETF-...}/ — same internal helpers,
// different path prefix. ds_ph.zarr schema matches the per-fund layout
// (coords symbol = bw_sym_id, teo; data_vars adj_mv, has_new_data, aum_reported,
// aum_erm3) with one addition: an `availability_date` coordinate aligned to
// `teo` (the tradeable/observable axis is explicit from day one — see
// docs/architecture/CANONICAL_INTELLIGENCE_OBJECTS.md §3 / §9). teo_frequency
// is `daily` here (vs `monthly` for funds, `quarterly` for 13F filers). Only
// the in-ERM3 sleeve is materialized (cash / unresolvable lines are dropped,
// same as the fund path), so every returned holding is in-ERM3 by construction.
// ===========================================================================

/** ticker → bw_etf_id, per the per-entity-id convention. */
export function tickerToBwEtfId(ticker: string): string {
  return `BW-ETF-${ticker.trim().toUpperCase()}`;
}

async function openEtfZarrGroup(
  bwEtfId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  // ETFs domain tree (Funds_DAG #76): ERM3_ETFs/… when ZARR_ETFS_GCS_PREFIX
  // is set, else the shared funds prefix.
  return openZarrGroupAt(
    `bw_etf_id/${bwEtfId}/${basename}`,
    "ZARR_ETFS_GCS_PREFIX",
  );
}

export interface EtfHolding {
  bw_sym_id: string;
  adj_mv: number;
  /** Fraction of `aum_erm3` (the in-ERM3 denominator). Null when AUM is null/0. */
  weight: number | null;
}

export interface EtfHoldingsSnapshot {
  portfolio_id: string;
  ticker: string;
  source_kind: "etf";
  teo_frequency: "daily";
  sponsor: string | null;
  /** Economic-truth axis: the sponsor's "Fund Holdings as of" date (= latest teo). */
  report_date: string;
  /** Tradeable/observable axis: when that holdings file was first observed. May be null. */
  availability_date: string | null;
  aum_reported: number | null;
  aum_erm3: number | null;
  /** aum_erm3 / aum_reported — share of the resolved sleeve that is in the ERM3 universe. */
  coverage_pct: number | null;
  n_holdings_returned: number;
  n_total_holdings: number;
  holdings: EtfHolding[];
}

/**
 * Top-N current holdings at the latest teo for an ETF (by ticker). Default n=25.
 * Returns null when the ETF has no zarr or no positive holdings.
 *
 * Symmetric to `readFundHoldingsTopN` but reads `bw_etf_id/...` and surfaces the
 * canonical-surface metadata (source_kind, teo_frequency, report_date vs
 * availability_date, sponsor) alongside the holdings.
 */
export async function readEtfHoldingsTopN(
  ticker: string,
  n = 25,
): Promise<EtfHoldingsSnapshot | null> {
  const bwEtfId = tickerToBwEtfId(ticker);
  const safeN = Math.min(Math.max(n, 1), 1000);
  const ck = generateCacheKey("funds_zarr", "etf_holdings_top", {
    etf: bwEtfId,
    n: safeN,
  });
  const snapshot = await withZarrCache(
    ck,
    () => computeEtfHoldingsTopN(ticker, bwEtfId, safeN),
    { emptyValue: null, ttl: FUNDS_ZARR_DAILY_SURFACE_TTL },
  );
  if (!snapshot) return null;
  // Scrub outside the cache boundary — see readFundHoldingsTopN.
  return {
    ...snapshot,
    holdings: await applyScrubToHoldings(snapshot.holdings),
  };
}

async function computeEtfHoldingsTopN(
  ticker: string,
  bwEtfId: string,
  safeN: number,
): Promise<EtfHoldingsSnapshot | null> {
  const grp = await openEtfZarrGroup(bwEtfId, "ds_ph.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;
  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;

  const [adjMv, aumReported, aumErm3, availStrings] = await Promise.all([
    readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length),
    readScalarAtTeo(grp, "aum_reported", teoIdx),
    readScalarAtTeo(grp, "aum_erm3", teoIdx),
    readDatetimeVarStrings(grp, "availability_date"),
  ]);
  if (!adjMv) return null;

  const groupAttrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const sponsor = typeof groupAttrs.sponsor === "string" ? groupAttrs.sponsor : null;

  const holdings: EtfHolding[] = [];
  for (let i = 0; i < adjMv.length; i++) {
    const v = adjMv[i];
    if (v != null && v > 0) {
      holdings.push({
        bw_sym_id: symbols[i]!,
        adj_mv: v,
        weight: aumErm3 != null && aumErm3 > 0 ? v / aumErm3 : null,
      });
    }
  }
  if (holdings.length === 0) return null;
  holdings.sort((a, b) => b.adj_mv - a.adj_mv);

  const availability_date =
    availStrings && availStrings[teoIdx] ? availStrings[teoIdx]! : null;
  const coverage_pct =
    aumReported != null && aumReported > 0 && aumErm3 != null
      ? aumErm3 / aumReported
      : null;

  const top = holdings.slice(0, safeN);
  return {
    portfolio_id: bwEtfId,
    ticker: ticker.trim().toUpperCase(),
    source_kind: "etf",
    teo_frequency: "daily",
    sponsor,
    report_date: teo,
    availability_date,
    aum_reported: aumReported,
    aum_erm3: aumErm3,
    coverage_pct,
    n_holdings_returned: Math.min(safeN, holdings.length),
    n_total_holdings: holdings.length,
    holdings: top,
  };
}

// ===========================================================================
// BENCHMARK READERS — canonical PortfolioSurface, source_kind=benchmark (L.8)
//
// Per the Option-3 design (CANONICAL_INTELLIGENCE_OBJECTS.md §9): a benchmark is
// a PortfolioSurface with source_kind=benchmark carrying a serialized
// BenchmarkContext (the immutable definition). Per-benchmark stores live under
// bw_bench_id/{BW-BENCH-...}/ds_ph.zarr — same (symbol, teo) layout as the other
// surfaces, but `adj_mv` is the normalized in-ERM3 weight (each teo column sums
// to ~1.0), not dollars. The BenchmarkContext JSON is the group attr
// `benchmark_context`. v1 catalog: BW-BENCH-SPY (index_proxy ← IVV),
// BW-BENCH-EQ70-30 (blend 70% IWB + 30% IWM).
// ===========================================================================

/**
 * Resolve a `benchmark=` string (alias or `bw_bench_id`) → `bw_bench_id`, or null.
 *
 * Backed by the committed cross-repo mirror at `mcp/data/benchmark_master.json`
 * (generated from `Funds_DAG/configs/benchmark_universe.yaml` via
 * `Funds_DAG/scripts/export_benchmark_master_json.py` — same pattern as the
 * OpenAPI/capabilities mirror). Adding a benchmark is one-touch on the YAML —
 * regenerate the JSON and commit it; no edits to this file are needed.
 *
 * Degrades safely: if the mirror is missing/empty, only `BW-BENCH-*` ids pass
 * through (aliases return null).
 */
export function resolveBenchmarkId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (s.toUpperCase().startsWith("BW-BENCH-")) return s.toUpperCase();
  return lookupBenchmarkAlias(s);
}

/** Resolve a fit-subject string: a BW-* portfolio id as-is, else an ETF ticker → BW-ETF-{TICKER}. */
export function resolveSubjectId(input: string): string {
  const s = (input ?? "").trim();
  return s.toUpperCase().startsWith("BW-") ? s.toUpperCase() : tickerToBwEtfId(s);
}

async function openBenchmarkZarrGroup(
  bwBenchId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  // Benchmarks domain tree (Funds_DAG #76): ERM3_Reference/… when
  // ZARR_BENCH_GCS_PREFIX is set, else the shared funds prefix.
  return openZarrGroupAt(
    `bw_bench_id/${bwBenchId}/${basename}`,
    "ZARR_BENCH_GCS_PREFIX",
  );
}

/** Dispatch a portfolio_id to its ds_*.zarr group by prefix (fund / filer / ETF / benchmark). */
async function openSurfaceGroup(
  portfolioId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  const id = portfolioId.toUpperCase();
  if (id.startsWith("BW-FUND-")) return openFundZarrGroup(id, basename);
  if (id.startsWith("BW-FILER-")) return openFilerZarrGroup(id, basename);
  if (id.startsWith("BW-ETF-")) return openEtfZarrGroup(id, basename);
  if (id.startsWith("BW-BENCH-")) return openBenchmarkZarrGroup(id, basename);
  return null;
}

const _BENCH_PORTFOLIO_KIND: Record<string, string> = {
  "BW-FUND-": "fund",
  "BW-FILER-": "filer_13f",
  "BW-ETF-": "etf",
  "BW-BENCH-": "benchmark",
};

function _portfolioSourceKind(portfolioId: string): string {
  const id = portfolioId.toUpperCase();
  for (const [pfx, kind] of Object.entries(_BENCH_PORTFOLIO_KIND)) {
    if (id.startsWith(pfx)) return kind;
  }
  return "unknown";
}

interface SurfaceWeightVector {
  portfolio_id: string;
  source_kind: string;
  teo: string;
  /** symbol → in-ERM3 weight (Σ adj_mv normalized to 1; positive entries only). */
  weights: Map<string, number>;
}

/**
 * Read a portfolio surface's normalized weight vector at the latest teo
 * (or the latest teo ≤ `asOfTeo`). Works for fund / 13F filer / ETF / benchmark
 * ids. Returns null when the surface is missing or has no usable teo.
 *
 * Deliberately NOT Redis-cached here: `weights` is a `Map`, which does not
 * round-trip through JSON (Upstash/`JSON.stringify` serializes a Map to
 * `"{}"`), and this function is only called internally (twice per
 * `computeBenchmarkFit` call — subject + benchmark), never directly by an
 * API route. `computeBenchmarkFit` caches its fully plain-JSON result
 * instead, which covers the same GCS round-trips for repeat requests.
 */
export async function readSurfaceWeightVector(
  portfolioId: string,
  opts: { asOfTeo?: string } = {},
): Promise<SurfaceWeightVector | null> {
  const grp = await openSurfaceGroup(portfolioId, "ds_ph.zarr");
  if (!grp) return null;
  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;
  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  let teoIdx = teos.length - 1;
  if (opts.asOfTeo) {
    teoIdx = -1;
    for (let i = teos.length - 1; i >= 0; i--) {
      if ((teos[i] ?? "") <= opts.asOfTeo) { teoIdx = i; break; }
    }
    if (teoIdx < 0) return null;
  }
  const adj = await readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length);
  if (!adj) return null;
  let total = 0;
  for (const v of adj) if (v != null && v > 0) total += v;
  const weights = new Map<string, number>();
  if (total > 0) {
    for (let i = 0; i < adj.length; i++) {
      const v = adj[i];
      if (v != null && v > 0) weights.set(symbols[i]!, v / total);
    }
  }
  if (weights.size === 0) return null;
  return { portfolio_id: portfolioId.toUpperCase(), source_kind: _portfolioSourceKind(portfolioId), teo: teos[teoIdx]!, weights };
}

export interface BenchmarkSnapshot {
  benchmark_context_id: string;
  name: string;
  benchmark_kind: string;
  source_kind: "benchmark";
  teo_frequency: string;
  /** Economic-truth axis: the benchmark surface's latest teo. */
  report_date: string;
  /** Tradeable/observable axis: when that snapshot was first observed. May be null. */
  availability_date: string | null;
  /** The full serialized BenchmarkContext (methodology, rebalance schedule, proxy/components, …). */
  benchmark_context: Record<string, unknown> | null;
  n_constituents: number;
  top_constituents: { bw_sym_id: string; weight: number }[];
}

/**
 * Read a benchmark's surface snapshot by bw_bench_id *or* alias (e.g. "SPY").
 * Returns null when the alias doesn't resolve or the surface is missing.
 */
export async function readBenchmarkSurface(
  idOrAlias: string,
  n = 25,
): Promise<BenchmarkSnapshot | null> {
  const bwBenchId = resolveBenchmarkId(idOrAlias);
  if (!bwBenchId) return null;

  const safeN = Math.min(Math.max(n, 1), 1000);
  const ck = generateCacheKey("funds_zarr", "benchmark_surface", {
    bench: bwBenchId,
    n: safeN,
  });
  return withZarrCache(ck, () => computeBenchmarkSurface(bwBenchId, safeN), {
    emptyValue: null,
    ttl: FUNDS_ZARR_DAILY_SURFACE_TTL,
  });
}

async function computeBenchmarkSurface(
  bwBenchId: string,
  safeN: number,
): Promise<BenchmarkSnapshot | null> {
  const grp = await openBenchmarkZarrGroup(bwBenchId, "ds_ph.zarr");
  if (!grp) return null;
  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;
  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;
  const teoIdx = teos.length - 1;

  const [adj, availStrings] = await Promise.all([
    readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length),
    readDatetimeVarStrings(grp, "availability_date"),
  ]);
  if (!adj) return null;

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  let ctx: Record<string, unknown> | null = null;
  if (typeof attrs.benchmark_context === "string") {
    try { ctx = JSON.parse(attrs.benchmark_context); } catch { ctx = null; }
  }
  const cons: { bw_sym_id: string; weight: number }[] = [];
  let total = 0;
  for (const v of adj) if (v != null && v > 0) total += v;
  for (let i = 0; i < adj.length; i++) {
    const v = adj[i];
    if (v != null && v > 0) cons.push({ bw_sym_id: symbols[i]!, weight: total > 0 ? v / total : v });
  }
  cons.sort((a, b) => b.weight - a.weight);

  return {
    benchmark_context_id: bwBenchId,
    name: typeof attrs.name === "string" ? attrs.name : bwBenchId,
    benchmark_kind: typeof attrs.benchmark_kind === "string" ? attrs.benchmark_kind : (ctx?.benchmark_kind as string) ?? "index_proxy",
    source_kind: "benchmark",
    teo_frequency: typeof attrs.teo_frequency === "string" ? attrs.teo_frequency : "daily",
    report_date: teos[teoIdx]!,
    availability_date: availStrings && availStrings[teoIdx] ? availStrings[teoIdx]! : null,
    benchmark_context: ctx,
    n_constituents: cons.length,
    top_constituents: cons.slice(0, safeN),
  };
}

export interface BenchmarkFitResult {
  fit_schema_version: string;
  subject_id: string;
  subject_source_kind: string;
  benchmark_context_id: string;
  benchmark_name: string;
  subject_teo: string;
  benchmark_teo: string;
  n_subject_holdings: number;
  n_benchmark_constituents: number;
  n_overlap: number;
  active_share: number;
  active_weight_rms: number;       // a coarse tracking-error proxy
  weight_in_benchmark: number;     // share of the subject that overlaps the benchmark
  benchmark_coverage: number;      // share of the benchmark the subject touches
  top_overweights: { bw_sym_id: string; subject_weight: number; benchmark_weight: number; active_weight: number }[];
  top_underweights: { bw_sym_id: string; subject_weight: number; benchmark_weight: number; active_weight: number }[];
}

const BENCHMARK_FIT_SCHEMA_VERSION = "benchmark-fit/1.0";

/**
 * Fit a subject portfolio's weight vector against a benchmark surface.
 *   - `subjectId`: a BW-* portfolio id, or an ETF ticker (→ BW-ETF-{TICKER}).
 *   - `benchmarkIdOrAlias`: a bw_bench_id or alias ("SPY", "70/30", …).
 *   - `asOf`: optional YYYY-MM-DD upper bound on the subject's teo; the benchmark
 *     is then taken at its latest teo ≤ the subject's teo (knowledge-friendly).
 * Returns null when the benchmark alias doesn't resolve or either surface is missing.
 */
export async function computeBenchmarkFit(
  subjectId: string,
  benchmarkIdOrAlias: string,
  opts: { asOf?: string; topN?: number } = {},
): Promise<BenchmarkFitResult | null> {
  const bwBenchId = resolveBenchmarkId(benchmarkIdOrAlias);
  if (!bwBenchId) return null;
  const resolvedSubject = resolveSubjectId(subjectId);
  const topN = Math.min(Math.max(opts.topN ?? 10, 1), 100);

  // `readSurfaceWeightVector`'s Map-valued result isn't JSON-cacheable, so we
  // cache at this (already plain-JSON) boundary instead — see the "not
  // cached" note on `readSurfaceWeightVector` below. The cached payload
  // embeds the deploy-time schema-version constant, so the key must carry it
  // too: a version bump then cold-starts its own keyspace instead of serving
  // mixed shapes until the old entries expire.
  const ck = generateCacheKey("funds_zarr", "benchmark_fit", {
    subject: resolvedSubject,
    bench: bwBenchId,
    asOf: opts.asOf ?? "",
    topN,
    v: BENCHMARK_FIT_SCHEMA_VERSION,
  });
  return withZarrCache(
    ck,
    () => computeBenchmarkFitUncached(resolvedSubject, bwBenchId, topN, opts),
    { emptyValue: null, ttl: FUNDS_ZARR_DAILY_SURFACE_TTL },
  );
}

async function computeBenchmarkFitUncached(
  resolvedSubject: string,
  bwBenchId: string,
  topN: number,
  opts: { asOf?: string },
): Promise<BenchmarkFitResult | null> {
  const subj = await readSurfaceWeightVector(resolvedSubject, { asOfTeo: opts.asOf });
  if (!subj) return null;
  // benchmark at its latest teo ≤ the subject's teo (never peek ahead)
  const bench = await readSurfaceWeightVector(bwBenchId, { asOfTeo: subj.teo });
  if (!bench) return null;

  const benchAttrs = await (async () => {
    const g = await openBenchmarkZarrGroup(bwBenchId, "ds_ph.zarr");
    return g ? ((g.attrs ?? {}) as Record<string, unknown>) : {};
  })();
  const allSyms = new Set<string>([...subj.weights.keys(), ...bench.weights.keys()]);
  let activeAbs = 0, activeSq = 0, weightInBench = 0, benchCoverage = 0, nOverlap = 0;
  const active: { bw_sym_id: string; subject_weight: number; benchmark_weight: number; active_weight: number }[] = [];
  for (const s of allSyms) {
    const wp = subj.weights.get(s) ?? 0;
    const wb = bench.weights.get(s) ?? 0;
    const a = wp - wb;
    activeAbs += Math.abs(a);
    activeSq += a * a;
    if (wp > 0 && wb > 0) { nOverlap++; weightInBench += wp; benchCoverage += wb; }
    active.push({ bw_sym_id: s, subject_weight: wp, benchmark_weight: wb, active_weight: a });
  }
  const over = active.filter((r) => r.active_weight > 0).sort((a, b) => b.active_weight - a.active_weight).slice(0, topN);
  const under = active.filter((r) => r.active_weight < 0).sort((a, b) => a.active_weight - b.active_weight).slice(0, topN);

  return {
    fit_schema_version: BENCHMARK_FIT_SCHEMA_VERSION,
    subject_id: resolvedSubject,
    subject_source_kind: subj.source_kind,
    benchmark_context_id: bwBenchId,
    benchmark_name: typeof benchAttrs.name === "string" ? benchAttrs.name : bwBenchId,
    subject_teo: subj.teo,
    benchmark_teo: bench.teo,
    n_subject_holdings: subj.weights.size,
    n_benchmark_constituents: bench.weights.size,
    n_overlap: nOverlap,
    active_share: 0.5 * activeAbs,
    active_weight_rms: Math.sqrt(activeSq),
    weight_in_benchmark: weightInBench,
    benchmark_coverage: benchCoverage,
    top_overweights: over,
    top_underweights: under,
  };
}

// ===========================================================================
// SURFACE PORTFOLIO READER — per-ETF / per-benchmark ds_portfolio (L.6/L.8)
//
// ETF and benchmark surfaces get the same L1/L2/L3 return decomposition funds
// have (Funds_DAG `surface_portfolios_zarr`): `<prefix>/{id}/ds_portfolio.zarr`,
// same (teo,) schema as the per-fund one (PORTFOLIO_VARS). The group attrs carry
// `source_kind`, `weight_basis` (v1: "latest_holdings_constant" — the factor
// profile of the surface's current composition over ERM3 monthly's full history;
// "time_varying" once a daily surface has accumulated months), and `teo_frequency`
// (always "monthly" — the decomposition is vs ds_erm3_monthly).
// ===========================================================================

export interface SurfacePortfolioRow {
  teo: string;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
  identity_residual: number | null;
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
}

export interface SurfacePortfolioSeries {
  portfolio_id: string;
  source_kind: string;             // fund | etf | benchmark | filer_13f
  weight_basis: string | null;     // latest_holdings_constant | time_varying
  teo_frequency: string;           // "monthly"
  /** Diversification-credited variance shares (full-window), from the zarr attrs; null if absent. */
  variance_shares: {
    market: number | null;
    sector: number | null;
    subsector: number | null;
    residual: number | null;
  } | null;
  n_rows: number;
  rows: SurfacePortfolioRow[];
}

/**
 * Read the per-ETF / per-benchmark portfolio return-decomposition time series.
 * `portfolioId` = a BW-* surface id (BW-ETF-…, BW-BENCH-…, also BW-FUND-…/BW-FILER-…
 * fall through to their own ds_portfolio.zarr). Returns null when there's no zarr,
 * no teos, or nothing in the requested date window.
 */
export async function readSurfacePortfolioSeries(
  portfolioId: string,
  options: FundPortfolioOptions = {},
): Promise<SurfacePortfolioSeries | null> {
  const ck = generateCacheKey("funds_zarr", "surface_portfolio", {
    portfolio: portfolioId.toUpperCase(),
    start: options.startDate ?? "",
    end: options.endDate ?? "",
  });
  return withZarrCache(
    ck,
    () => computeSurfacePortfolioSeries(portfolioId, options),
    { emptyValue: null },
  );
}

async function computeSurfacePortfolioSeries(
  portfolioId: string,
  options: FundPortfolioOptions,
): Promise<SurfacePortfolioSeries | null> {
  const grp = await openSurfaceGroup(portfolioId, "ds_portfolio.zarr");
  if (!grp) return null;
  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  let t0 = 0;
  let t1 = teos.length;
  if (options.startDate) while (t0 < t1 && teos[t0]! < options.startDate) t0++;
  if (options.endDate) while (t1 > t0 && teos[t1 - 1]! > options.endDate) t1--;
  if (t0 >= t1) return null;

  const series = await Promise.all(
    PORTFOLIO_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSlice1d(grp, varName, t0, t1),
    })),
  );
  const rows: SurfacePortfolioRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: Record<string, unknown> = { teo: teos[t0 + i]! };
    for (const s of series) row[s.name] = s.data?.[i] ?? null;
    rows.push(row as unknown as SurfacePortfolioRow);
  }

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const numAttr = (k: string): number | null => {
    const v = attrs[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const varianceShares =
    attrs.adjusted_l1_market_er != null || attrs.adjusted_l3_residual_er != null
      ? {
          market: numAttr("adjusted_l1_market_er"),
          sector: numAttr("adjusted_l2_sector_er"),
          subsector: numAttr("adjusted_l3_subsector_er"),
          residual: numAttr("adjusted_l3_residual_er"),
        }
      : null;

  return {
    portfolio_id: portfolioId.toUpperCase(),
    source_kind: typeof attrs.source_kind === "string" ? attrs.source_kind : _portfolioSourceKind(portfolioId),
    weight_basis: typeof attrs.weight_basis === "string" ? attrs.weight_basis : null,
    teo_frequency: typeof attrs.teo_frequency === "string" ? attrs.teo_frequency : "monthly",
    variance_shares: varianceShares,
    n_rows: rows.length,
    rows,
  };
}
