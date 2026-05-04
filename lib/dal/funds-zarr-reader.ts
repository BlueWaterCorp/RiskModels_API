/**
 * Funds-side Zarr reader on GCS.
 *
 * Per-fund stores live at:
 *   gs://{bucket}/{basePath}/bw_fund_id/{BW-FUND-...}/ds_portfolio.zarr
 *   gs://{bucket}/{basePath}/bw_fund_id/{BW-FUND-...}/ds_ph.zarr        (B.2.b)
 *   gs://{bucket}/{basePath}/bw_fund_id/{BW-FUND-...}/ds_hr.zarr        (B.2.c)
 *
 * Default GCS prefix is `rm_api_data/ERM3_Funds` (env override:
 * `ZARR_FUNDS_GCS_PREFIX`). The bucket is shared with the stocks-side
 * `rm_api_data` per ARCHITECTURE_FUNDS_API.md §3.1.1; only the basePath
 * differs.
 *
 * Stage B.2.a ships `readFundPortfolioSeries` only — Slice 8's per-fund
 * `ds_portfolio.zarr` (dim `(teo,)`, ten data_vars). Holdings (ds_ph) and
 * hedge (ds_hr) follow in B.2.b / B.2.c.
 *
 * Internal-only: never expose bucket names, gs:// URLs, or zarr paths in
 * thrown errors or API JSON.
 *
 * TODO(dedup): the GCS plumbing here (getGcs, GcsZarrStore, openFundZarrGroup,
 * readTeoStrings) is structurally identical to lib/dal/zarr-reader.ts.
 * Extract to lib/dal/zarr-gcs.ts as a follow-up — kept duplicated in B.2.a
 * so the stocks-side module stays untouched.
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

/** Per-cell stores: portfolio_style/{Cell_Name}/... and equity_style_9box/{Cell_Name}/... */
async function openCohortZarrGroup(
  kind: "portfolio_style" | "equity_style_9box",
  pathComponent: string,
  basename: string,
): Promise<Group<Readable> | null> {
  return openZarrGroupAt(`${kind}/${pathComponent}/${basename}`);
}

function nsToIsoDate(ns: bigint): string {
  const ms = Number(ns / 1_000_000n);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function readTeoStrings(
  grp: Group<Readable>,
): Promise<string[] | null> {
  try {
    const loc = grp.resolve("teo");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;

    const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
    const units = typeof attrs.units === "string" ? attrs.units : "";
    const cfMatch = units.match(
      /^days since (\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2})?/,
    );

    if (d instanceof BigInt64Array && cfMatch) {
      const baseMs = Date.parse(`${cfMatch[1]}T00:00:00Z`);
      if (!Number.isFinite(baseMs)) return null;
      const MS_PER_DAY = 86_400_000;
      return Array.from(d, (v) => {
        const t = baseMs + Number(v) * MS_PER_DAY;
        const dt = new Date(t);
        return Number.isFinite(dt.getTime())
          ? dt.toISOString().slice(0, 10)
          : "";
      });
    }
    if (d instanceof BigInt64Array) {
      return Array.from(d, (v) => nsToIsoDate(v));
    }
    if (ArrayBuffer.isView(d) && !(d instanceof Uint8Array)) {
      const nums = d as unknown as ArrayLike<number>;
      return Array.from(nums, (v) => {
        const ms = Number(v) / 1_000_000;
        const dt = new Date(ms);
        return Number.isFinite(dt.getTime())
          ? dt.toISOString().slice(0, 10)
          : "";
      });
    }
    return null;
  } catch {
    return null;
  }
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

  return {
    teo,
    aum_reported: aumReported,
    aum_erm3: aumErm3,
    n_holdings_returned: Math.min(safeN, holdings.length),
    n_total_holdings: holdings.length,
    holdings: holdings.slice(0, safeN),
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

  return {
    teo,
    weighting: requestedWeighting,
    n_returned: Math.min(safeN, all.length),
    n_total_holdings: all.length,
    holdings: all.slice(0, safeN),
  };
}
