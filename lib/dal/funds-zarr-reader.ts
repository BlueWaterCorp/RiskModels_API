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

async function openFundZarrGroup(
  bwFundId: string,
  basename: string,
): Promise<Group<Readable> | null> {
  const { bucket: bucketName, basePath } = parseFundsZarrPrefix();
  const fullPrefix = `${basePath}/bw_fund_id/${bwFundId}/${basename}`
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
