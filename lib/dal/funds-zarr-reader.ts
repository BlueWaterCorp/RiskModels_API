/**
 * Entity-side Zarr reader on GCS (funds + 13F filers).
 *
 * Per-entity stores live at:
 *   gs://{bucket}/{basePath}/bw_fund_id/{BW-FUND-...}/{ds_portfolio,ds_ph,ds_hr,ds_nav}.zarr
 *   gs://{bucket}/{basePath}/bw_filer_id/{BW-FILER-CIK...}/{ds_portfolio,ds_ph}.zarr
 *
 * Default GCS prefix is `rm_api_data/ERM3_Funds` (env override:
 * `ZARR_FUNDS_GCS_PREFIX`). The bucket is shared with the stocks-side
 * `rm_api_data` per ARCHITECTURE_FUNDS_API.md §3.1.1; only the basePath
 * differs.
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

import { Storage, type Bucket } from "@google-cloud/storage";
import {
  get,
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

function parseFundsZarrPrefix(): { bucket: string; basePath: string } {
  const raw = (process.env.ZARR_FUNDS_GCS_PREFIX ?? "rm_api_data/ERM3_Funds").trim();
  const i = raw.indexOf("/");
  if (i <= 0) return { bucket: raw || "rm_api_data", basePath: "" };
  return { bucket: raw.slice(0, i), basePath: raw.slice(i + 1).replace(/\/$/, "") };
}

async function openZarrGroupAt(
  relativePath: string,
): Promise<Group<Readable> | null> {
  const { bucket: bucketName, basePath } = parseFundsZarrPrefix();
  const fullPrefix = `${basePath}/${relativePath}`
    .replace(/\/+/g, "/")
    .replace(/^\//, "");
  try {
    const bucket = getGcs().bucket(bucketName);
    const raw = new GcsZarrStore(bucket, fullPrefix);
    const consolidated = await tryWithConsolidated(raw);
    const store = consolidated as unknown as Readable;
    return (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
  } catch {
    console.error("[funds-zarr] open group failed");
    return null;
  }
}

async function openFundZarrGroup(
  bwFundId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  return openZarrGroupAt(`bw_fund_id/${bwFundId}/${basename}`);
}

async function openFilerZarrGroup(
  bwFilerId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  return openZarrGroupAt(`bw_filer_id/${bwFilerId}/${basename}`);
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
  } catch {
    return null;
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
export async function readFundPortfolioSeries(
  bwFundId: string,
  options: FundPortfolioOptions = {},
): Promise<FundPortfolioRow[]> {
  const grp = await openFundZarrGroup(bwFundId, "ds_portfolio.zarr");
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
  const grp = await openFundZarrGroup(bwFundId, "ds_ph.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;

  const [adjMv, aumReported, aumErm3] = await Promise.all([
    readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length),
    readScalarAtTeo(grp, "aum_reported", teoIdx),
    readScalarAtTeo(grp, "aum_erm3", teoIdx),
  ]);
  if (!adjMv) return null;

  const holdings: FundHolding[] = [];
  for (let i = 0; i < adjMv.length; i++) {
    const v = adjMv[i];
    if (v != null && v > 0) {
      holdings.push({
        bw_sym_id: symbols[i]!,
        adj_mv: v,
        weight:
          aumErm3 != null && aumErm3 > 0 ? v / aumErm3 : null,
      });
    }
  }
  if (holdings.length === 0) return null;

  holdings.sort((a, b) => b.adj_mv - a.adj_mv);
  const safeN = Math.min(Math.max(n, 1), 1000);
  const top = holdings.slice(0, safeN);

  return {
    teo,
    aum_reported: aumReported,
    aum_erm3: aumErm3,
    n_holdings_returned: Math.min(safeN, holdings.length),
    n_total_holdings: holdings.length,
    holdings: await applyScrubToHoldings(top),
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
  } catch {
    return null;
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
    holdings: await applyScrubToHoldings(top),
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
  /** Latest daily L3 explained-risk shares from `security_history_latest` (optional). */
  l3_market_er?: number | null;
  l3_sector_er?: number | null;
  l3_subsector_er?: number | null;
  l3_residual_er?: number | null;
}

export interface FilerHoldingsSnapshot {
  teo: string;
  total_aum_usd: number | null;
  /** Sum of `adj_mv` over the in-ERM3 mapped subset; null pre-D.8.1. */
  aum_in_erm3: number | null;
  n_holdings_returned: number;
  n_total_holdings: number;
  holdings: FilerHolding[];
}

/**
 * Top-N current holdings at the latest teo for a 13F filer. Default n=25.
 * Returns null when the filer has no zarr or no positive holdings.
 *
 * Symmetric to `readFundHoldingsTopN` but reads `bw_filer_id/...` and
 * surfaces the security id under `security_id` (since pre-D.8.1 it may be
 * a raw security id rather than bw_sym_id).
 */
export async function readFilerHoldingsTopN(
  bwFilerId: string,
  n = 25,
): Promise<FilerHoldingsSnapshot | null> {
  const grp = await openFilerZarrGroup(bwFilerId, "ds_ph.zarr");
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos || teos.length === 0) return null;

  const symbols = await readSymbolStrings(grp);
  if (!symbols || symbols.length === 0) return null;

  const teoIdx = teos.length - 1;
  const teo = teos[teoIdx]!;

  // total_aum_usd may not exist on filer ds_ph — readScalarAtTeo returns null on missing var.
  const [adjMv, totalAumUsd, aumInErm3] = await Promise.all([
    readFloatAtTeo(grp, "adj_mv", teoIdx, symbols.length),
    readScalarAtTeo(grp, "total_aum_usd", teoIdx),
    readScalarAtTeo(grp, "aum_in_erm3", teoIdx),
  ]);
  if (!adjMv) return null;

  const denom = totalAumUsd != null && totalAumUsd > 0 ? totalAumUsd : null;
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
  const safeN = Math.min(Math.max(n, 1), 1000);
  const top = holdings.slice(0, safeN);

  return {
    teo,
    total_aum_usd: totalAumUsd,
    aum_in_erm3: aumInErm3,
    n_holdings_returned: Math.min(safeN, holdings.length),
    n_total_holdings: holdings.length,
    holdings: await applyScrubToFilerHoldings(top),
  };
}

/**
 * One row of the per-filer portfolio time series. Phase 1 emits only
 * diagnostics + AUM + (post-kernel) style-attribution metrics. Return
 * components are NULL for filers until Phase 2 lands.
 */
export interface FilerPortfolioRow {
  teo: string;
  // Diagnostics (parallel to fund-side)
  weight_sum: number | null;
  n_holdings_active: number | null;
  effective_n: number | null;
  top10_weight_sum: number | null;
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
  "top10_weight_sum",
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

  const series = await Promise.all(
    FILER_PORTFOLIO_VARS.map(async (varName) => ({
      name: varName,
      data: await readFloatSlice1d(grp, varName, t0, t1),
    })),
  );

  const rows: FilerPortfolioRow[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const row: Record<string, unknown> = { teo: teos[t0 + i]! };
    for (const s of series) {
      row[s.name] = s.data?.[i] ?? null;
    }
    rows.push(row as unknown as FilerPortfolioRow);
  }
  return rows;
}

const FILER_RETURNS_VARS = [
  "portfolio_gross_return",
  "portfolio_market_return",
  "portfolio_sector_return",
  "portfolio_subsector_return",
  "portfolio_idiosyncratic_return",
] as const;

/** One monthly row from filer ``ds_returns_monthly.zarr`` (D.8.22). */
export interface FilerMonthlyReturnRow {
  teo: string;
  portfolio_gross_return: number | null;
  portfolio_market_return: number | null;
  portfolio_sector_return: number | null;
  portfolio_subsector_return: number | null;
  portfolio_idiosyncratic_return: number | null;
}

export interface FilerVarianceSharesBlock {
  market: number | null;
  sector: number | null;
  subsector: number | null;
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
    residual: num("adjusted_l3_residual_er"),
  };
  const recent: FilerVarianceSharesBlock = {
    market: num("adjusted_recent_l1_market_er"),
    sector: num("adjusted_recent_l2_sector_er"),
    subsector: num("adjusted_recent_l3_subsector_er"),
    residual: num("adjusted_recent_l3_residual_er"),
  };
  const hasAny = (v: FilerVarianceSharesBlock) =>
    v.market != null || v.sector != null || v.subsector != null || v.residual != null;
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
  return openZarrGroupAt(`bw_etf_id/${bwEtfId}/${basename}`);
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
  const safeN = Math.min(Math.max(n, 1), 1000);

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
    holdings: await applyScrubToHoldings(top),
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
  return openZarrGroupAt(`bw_bench_id/${bwBenchId}/${basename}`);
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
  const safeN = Math.min(Math.max(n, 1), 1000);

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

  const subj = await readSurfaceWeightVector(resolvedSubject, { asOfTeo: opts.asOf });
  if (!subj) return null;
  // benchmark at its latest teo ≤ the subject's teo (never peek ahead)
  const bench = await readSurfaceWeightVector(bwBenchId, { asOfTeo: subj.teo });
  if (!bench) return null;

  const benchAttrs = await (async () => {
    const g = await openBenchmarkZarrGroup(bwBenchId, "ds_ph.zarr");
    return g ? ((g.attrs ?? {}) as Record<string, unknown>) : {};
  })();

  const topN = Math.min(Math.max(opts.topN ?? 10, 1), 100);
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
