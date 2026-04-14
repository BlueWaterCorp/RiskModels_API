/**
 * Chunk-aware Zarr v2 reader on GCS for ERM3 history (internal).
 *
 * Parity / contract tests: compare slices to the Python reconciliation tooling
 * `sdk/scripts/mag7_dd_zarr_vs_api.py` (and `zarr_context.py`) for MAG7 tickers.
 *
 * Never put bucket names, gs:// URLs, or zarr paths in thrown errors or API JSON.
 */

import { createHash } from "node:crypto";
import type { AbsolutePath, Readable } from "@zarrita/storage";
import { Storage } from "@google-cloud/storage";
import type { Bucket } from "@google-cloud/storage";
import {
  get,
  open,
  root,
  slice,
  tryWithConsolidated,
  UnicodeStringArray,
} from "zarrita";
import type { Group } from "zarrita";
import { parseZarrGcsPrefix, getZarrFactorSetId, zarrDailyBasename, zarrHedgeBasename, zarrReturnsBasename } from "@/lib/zarr-config";
import { getCache, setCache, CACHE_TTL, generateCacheKey } from "@/lib/cache/redis";
import type { SecurityHistoryRow, V3MetricKey, V3Periodicity } from "./risk-engine-v3";
import { getZarrSpec, ZARR_UNSUPPORTED_DAILY_KEYS } from "./zarr-metric-registry";

let _storage: Storage | null = null;

function getGcs(): Storage {
  if (!_storage) {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        const credentials = JSON.parse(raw) as Record<string, unknown>;
        _storage = new Storage({ credentials });
      } catch {
        console.error("[zarr-internal] GCP_SERVICE_ACCOUNT_JSON parse failed");
        _storage = new Storage();
      }
    } else {
      _storage = new Storage();
    }
  }
  return _storage;
}

/** Minimal AsyncReadable for zarrita + consolidated metadata. */
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
      const err = e as { code?: number };
      if (err?.code === 404) return undefined;
      console.error("[zarr-internal] storage read failed");
      throw new Error("Zarr read failed");
    }
  }
}

async function openZarrGroup(objectPrefix: string): Promise<Group<Readable> | null> {
  const { bucket: bucketName, basePath } = parseZarrGcsPrefix();
  const fullPrefix = `${basePath}/${objectPrefix}`.replace(/\/+/g, "/").replace(/^\//, "");
  try {
    const bucket = getGcs().bucket(bucketName);
    const raw = new GcsZarrStore(bucket, fullPrefix);
    const consolidated = await tryWithConsolidated(raw);
    const store = consolidated as unknown as Readable;
    return (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
  } catch {
    console.error("[zarr-internal] open group failed");
    return null;
  }
}

function nsToIsoDate(ns: bigint): string {
  const ms = Number(ns / 1_000_000n);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function readTeoStrings(grp: Group<Readable>): Promise<string[] | null> {
  try {
    const loc = grp.resolve("teo");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof BigInt64Array) {
      return Array.from(d, (v) => nsToIsoDate(v));
    }
    return null;
  } catch {
    return null;
  }
}

async function readSymbolIndexMap(grp: Group<Readable>): Promise<Map<string, number> | null> {
  try {
    const loc = grp.resolve("symbol");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    const m = new Map<string, number>();
    if (d instanceof UnicodeStringArray) {
      for (let i = 0; i < d.length; i++) {
        m.set(String(d.get(i)).trim(), i);
      }
      return m;
    }
    return null;
  } catch {
    return null;
  }
}

async function readLevelIndexMap(grp: Group<Readable>): Promise<Map<string, number> | null> {
  try {
    const loc = grp.resolve("level");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    const m = new Map<string, number>();
    if (d instanceof UnicodeStringArray) {
      for (let i = 0; i < d.length; i++) {
        m.set(String(d.get(i)).trim().toLowerCase(), i);
      }
      return m;
    }
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

function upperBoundExclusive(sorted: string[], x: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function readFloatSeriesTeoSymbol(
  grp: Group<Readable>,
  varName: string,
  t0: number,
  t1: number,
  symIdx: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(t0, t1), symIdx]);
    const d = ch?.data;
    if (d instanceof Float32Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    if (d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch {
    return null;
  }
}

async function readFloatSeriesTeoSymbolLevel(
  grp: Group<Readable>,
  varName: string,
  t0: number,
  t1: number,
  symIdx: number,
  levelIdx: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(t0, t1), symIdx, levelIdx]);
    const d = ch?.data;
    if (d instanceof Float32Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    if (d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch {
    // Try alternate dimension order (symbol, teo, level) — unlikely; ignore.
    return null;
  }
}

export interface ReadHistorySliceParams {
  symbols: string[];
  keys: V3MetricKey[];
  periodicity: V3Periodicity;
  startDate?: string;
  endDate?: string;
  orderBy?: "asc" | "desc";
}

export interface ReadHistorySliceResult {
  rows: SecurityHistoryRow[];
  range: [string, string];
}

function shouldUseSupabaseForKeys(keys: V3MetricKey[]): boolean {
  for (const k of keys) {
    if (ZARR_UNSUPPORTED_DAILY_KEYS.has(k)) return true;
  }
  return false;
}

function cacheKeyForZarr(p: ReadHistorySliceParams): string {
  const factorSet = getZarrFactorSetId();
  const payload = JSON.stringify({
    s: [...p.symbols].sort(),
    k: [...p.keys].sort(),
    start: p.startDate ?? "",
    end: p.endDate ?? "",
    per: p.periodicity,
    ord: p.orderBy ?? "asc",
    fs: factorSet,
  });
  const h = createHash("sha256").update(payload).digest("hex");
  return generateCacheKey("zarr_hist", h);
}

export async function readHistorySlice(
  params: ReadHistorySliceParams,
): Promise<ReadHistorySliceResult> {
  const {
    symbols,
    keys,
    periodicity,
    startDate,
    endDate,
    orderBy = "asc",
  } = params;

  if (periodicity !== "daily" || shouldUseSupabaseForKeys(keys)) {
    return { rows: [], range: ["", ""] };
  }

  const ck = cacheKeyForZarr(params);
  const hit = await getCache<ReadHistorySliceResult>(ck);
  // `[]` is truthy in JS — only treat cache as a hit when we stored real rows.
  if (hit?.rows?.length) {
    return hit;
  }

  const dailyGrp = await openZarrGroup(zarrDailyBasename());
  if (!dailyGrp) {
    return { rows: [], range: ["", ""] };
  }

  const teo = await readTeoStrings(dailyGrp);
  const symMap = await readSymbolIndexMap(dailyGrp);
  if (!teo?.length || !symMap?.size) {
    return { rows: [], range: ["", ""] };
  }

  let t0 = 0;
  let t1 = teo.length;
  if (startDate) t0 = lowerBound(teo, startDate);
  if (endDate) t1 = upperBoundExclusive(teo, endDate);
  if (t1 < t0) t1 = t0;

  const rangeStart = teo[t0] ?? "";
  const rangeEnd = teo[Math.max(0, t1 - 1)] ?? "";

  const hedgeGrp = await openZarrGroup(zarrHedgeBasename());
  const returnsGrp = await openZarrGroup(zarrReturnsBasename());
  const levelMaps = returnsGrp ? await readLevelIndexMap(returnsGrp) : null;

  const rows: SecurityHistoryRow[] = [];

  for (const symbol of symbols) {
    const symIdx = symMap.get(symbol);
    if (symIdx === undefined) continue;
    const symbolIndex = symIdx;

    const seriesCache = new Map<string, (number | null)[] | null>();

    async function get2Cached(
      grp: Group<Readable> | null,
      varName: string,
    ): Promise<(number | null)[] | null> {
      if (!grp) return null;
      const ck2 = `${varName}`;
      if (!seriesCache.has(ck2)) {
        seriesCache.set(
          ck2,
          await readFloatSeriesTeoSymbol(grp, varName, t0, t1, symbolIndex),
        );
      }
      return seriesCache.get(ck2) ?? null;
    }

    for (const key of keys) {
      const spec = getZarrSpec(key);
      if (!spec) continue;

      if (spec.role === "daily") {
        const vals = await get2Cached(dailyGrp, spec.zarrVar);
        if (!vals) continue;
        for (let i = 0; i < vals.length; i++) {
          const teoStr = teo[t0 + i];
          if (!teoStr) continue;
          rows.push({
            symbol,
            teo: teoStr,
            periodicity: "daily",
            metric_key: key,
            metric_value: vals[i] ?? null,
          });
        }
        continue;
      }

      if (spec.role === "hedge") {
        if (!hedgeGrp) continue;
        if ("derivedVol23d" in spec && spec.derivedVol23d) {
          const raw = await get2Cached(hedgeGrp, "_stock_var");
          if (!raw) continue;
          for (let i = 0; i < raw.length; i++) {
            const teoStr = teo[t0 + i];
            if (!teoStr) continue;
            const sv = raw[i];
            let mv: number | null = null;
            if (sv != null && Number.isFinite(sv) && sv >= 0) {
              mv = Math.sqrt(sv * 252);
            }
            rows.push({
              symbol,
              teo: teoStr,
              periodicity: "daily",
              metric_key: key,
              metric_value: mv,
            });
          }
          continue;
        }
        if ("asStockVar" in spec && spec.asStockVar) {
          const vals = await get2Cached(hedgeGrp, "_stock_var");
          if (!vals) continue;
          for (let i = 0; i < vals.length; i++) {
            const teoStr = teo[t0 + i];
            if (!teoStr) continue;
            rows.push({
              symbol,
              teo: teoStr,
              periodicity: "daily",
              metric_key: key,
              metric_value: vals[i] ?? null,
            });
          }
          continue;
        }
        const vals = await get2Cached(hedgeGrp, spec.zarrVar);
        if (!vals) continue;
        for (let i = 0; i < vals.length; i++) {
          const teoStr = teo[t0 + i];
          if (!teoStr) continue;
          rows.push({
            symbol,
            teo: teoStr,
            periodicity: "daily",
            metric_key: key,
            metric_value: vals[i] ?? null,
          });
        }
        continue;
      }

      if (spec.role === "returns") {
        if (!returnsGrp || !levelMaps) continue;
        const li = levelMaps.get(spec.level);
        if (li === undefined) continue;
        const vals = await readFloatSeriesTeoSymbolLevel(
          returnsGrp,
          spec.zarrVar,
          t0,
          t1,
          symbolIndex,
          li,
        );
        if (!vals) continue;
        for (let i = 0; i < vals.length; i++) {
          const teoStr = teo[t0 + i];
          if (!teoStr) continue;
          rows.push({
            symbol,
            teo: teoStr,
            periodicity: "daily",
            metric_key: key,
            metric_value: vals[i] ?? null,
          });
        }
      }
    }
  }

  rows.sort((a, b) => {
    const c = a.teo.localeCompare(b.teo);
    if (c !== 0) return orderBy === "asc" ? c : -c;
    return a.metric_key.localeCompare(b.metric_key);
  });

  const result: ReadHistorySliceResult = {
    rows,
    range: [rangeStart, rangeEnd],
  };

  if (rows.length > 0) {
    await setCache(ck, result, CACHE_TTL.FREQUENT).catch(() => {});
  }

  return result;
}
