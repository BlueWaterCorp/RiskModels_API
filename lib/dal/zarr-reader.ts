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
    if (!(d instanceof BigInt64Array)) return null;

    // GCS ERM3 stores use CF-style time encoding: int64 day offsets with a
    // `units: "days since YYYY-MM-DD[ HH:MM:SS]"` attribute. Previous code
    // assumed datetime64[ns] nanosecond epochs and mapped every value to
    // 1970-01-01 - that was bug 2 in the flap diagnosis.
    const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
    const units = typeof attrs.units === "string" ? attrs.units : "";
    const cfMatch = units.match(/^days since (\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2})?/);
    if (cfMatch) {
      const baseMs = Date.parse(`${cfMatch[1]}T00:00:00Z`);
      if (!Number.isFinite(baseMs)) return null;
      const MS_PER_DAY = 86_400_000;
      return Array.from(d, (v) => {
        const t = baseMs + Number(v) * MS_PER_DAY;
        const dt = new Date(t);
        return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : "";
      });
    }

    // Legacy / backward-compat: some stores may still write datetime64[ns].
    return Array.from(d, (v) => nsToIsoDate(v));
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
    // Fixed-width numpy unicode arrays (<U20 etc.) → UnicodeStringArray (.get i).
    if (d instanceof UnicodeStringArray) {
      for (let i = 0; i < d.length; i++) {
        m.set(String(d.get(i)).trim(), i);
      }
      return m;
    }
    // Variable-length / object dtype strings → plain Array<string> (indexed).
    // This is what the production GCS stores use; diagnosed in the flap
    // investigation and verified via scripts/diagnose-zarr-decode.mjs.
    if (Array.isArray(d)) {
      for (let i = 0; i < d.length; i++) {
        m.set(String(d[i]).trim(), i);
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
    if (Array.isArray(d)) {
      for (let i = 0; i < d.length; i++) {
        m.set(String(d[i]).trim().toLowerCase(), i);
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

/** First index strictly greater than x. Use with `[t0, t1)` slice where the
 *  caller wants to include all elements `<= x`. */
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

  // Daily store is always opened. Hedge/returns are opened lazily only if
  // the requested key set actually touches them — avoids a pointless GCS
  // round-trip on vanilla returns/price queries.
  const dailyGrp = await openZarrGroup(zarrDailyBasename());
  if (!dailyGrp) {
    return { rows: [], range: ["", ""] };
  }
  const dailyTeo = await readTeoStrings(dailyGrp);
  const dailySymMap = await readSymbolIndexMap(dailyGrp);
  if (!dailyTeo?.length || !dailySymMap?.size) {
    return { rows: [], range: ["", ""] };
  }

  const needHedge = keys.some((k) => getZarrSpec(k)?.role === "hedge");
  const needReturns = keys.some((k) => getZarrSpec(k)?.role === "returns");

  const hedgeGrp = needHedge ? await openZarrGroup(zarrHedgeBasename()) : null;
  const hedgeTeo = hedgeGrp ? await readTeoStrings(hedgeGrp) : null;
  const hedgeSymMap = hedgeGrp ? await readSymbolIndexMap(hedgeGrp) : null;

  const returnsGrp = needReturns ? await openZarrGroup(zarrReturnsBasename()) : null;
  const returnsTeo = returnsGrp ? await readTeoStrings(returnsGrp) : null;
  const returnsSymMap = returnsGrp ? await readSymbolIndexMap(returnsGrp) : null;
  const levelMaps = returnsGrp ? await readLevelIndexMap(returnsGrp) : null;

  // Shortest common range across every store involved in this request,
  // further clipped to the caller's [startDate, endDate] window. This
  // guarantees every metric_row the caller sees lives inside a date window
  // that *all* requested stores cover — no misleading half-populated rows.
  // Each store's teo is sorted ascending, so we can just max the firsts and
  // min the lasts.
  let effStart = startDate ?? "";
  let effEnd = endDate ?? "9999-12-31";
  const involvedTeos: string[][] = [dailyTeo];
  if (hedgeGrp && hedgeTeo?.length) involvedTeos.push(hedgeTeo);
  if (returnsGrp && returnsTeo?.length) involvedTeos.push(returnsTeo);
  for (const t of involvedTeos) {
    const first = t[0]!;
    const last = t[t.length - 1]!;
    if (first > effStart) effStart = first;
    if (last < effEnd) effEnd = last;
  }
  const validWindow = effStart <= effEnd;

  // Per-store [t0, t1) bounds from the common window. Each store has its own
  // teo axis length and (potentially) its own holiday set, so positional
  // indices MUST NOT be shared across stores — that was bug 3.
  const boundsFor = (teo: string[] | null): [number, number] => {
    if (!teo?.length || !validWindow) return [0, 0];
    const t0 = lowerBound(teo, effStart);
    const t1 = upperBoundInclusive(teo, effEnd);
    return t1 < t0 ? [t0, t0] : [t0, t1];
  };
  const [dt0, dt1] = boundsFor(dailyTeo);
  const [ht0, ht1] = boundsFor(hedgeTeo);
  const [rt0, rt1] = boundsFor(returnsTeo);

  const rangeStart = validWindow ? (dailyTeo[dt0] ?? effStart) : "";
  const rangeEnd = validWindow ? (dailyTeo[Math.max(0, dt1 - 1)] ?? effEnd) : "";

  const rows: SecurityHistoryRow[] = [];

  for (const symbol of symbols) {
    // Each store has its OWN symbol roster and ordering. Resolve per store.
    const dailyIdx = dailySymMap.get(symbol);
    const hedgeIdx = hedgeSymMap?.get(symbol);
    const returnsIdx = returnsSymMap?.get(symbol);

    for (const key of keys) {
      const spec = getZarrSpec(key);
      if (!spec) continue;

      if (spec.role === "daily") {
        if (dailyIdx === undefined || dt1 <= dt0) continue;
        const vals = await readFloatSeriesTeoSymbol(
          dailyGrp,
          spec.zarrVar,
          dt0,
          dt1,
          dailyIdx,
        );
        if (!vals) continue;
        for (let i = 0; i < vals.length; i++) {
          const teoStr = dailyTeo[dt0 + i];
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
        if (!hedgeGrp || hedgeIdx === undefined || !hedgeTeo || ht1 <= ht0) continue;
        const isVolDerived = "derivedVol23d" in spec && spec.derivedVol23d;
        const isStockVarRaw = "asStockVar" in spec && spec.asStockVar;
        const zarrVar = isVolDerived || isStockVarRaw ? "_stock_var" : spec.zarrVar;
        const raw = await readFloatSeriesTeoSymbol(
          hedgeGrp,
          zarrVar,
          ht0,
          ht1,
          hedgeIdx,
        );
        if (!raw) continue;
        for (let i = 0; i < raw.length; i++) {
          const teoStr = hedgeTeo[ht0 + i];
          if (!teoStr) continue;
          const sv = raw[i];
          let mv: number | null;
          if (isVolDerived) {
            mv = sv != null && Number.isFinite(sv) && sv >= 0 ? Math.sqrt(sv * 252) : null;
          } else {
            mv = sv ?? null;
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

      if (spec.role === "returns") {
        if (
          !returnsGrp ||
          returnsIdx === undefined ||
          !returnsTeo ||
          !levelMaps ||
          rt1 <= rt0
        ) continue;
        const li = levelMaps.get(spec.level);
        if (li === undefined) continue;
        const vals = await readFloatSeriesTeoSymbolLevel(
          returnsGrp,
          spec.zarrVar,
          rt0,
          rt1,
          returnsIdx,
          li,
        );
        if (!vals) continue;
        for (let i = 0; i < vals.length; i++) {
          const teoStr = returnsTeo[rt0 + i];
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
