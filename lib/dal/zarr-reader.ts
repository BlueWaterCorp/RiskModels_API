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
import {
  parseZarrGcsPrefix,
  getZarrFactorSetId,
  zarrDailyBasename,
  zarrEtfBasename,
  zarrHedgeBasename,
  zarrLinkBetasBasename,
  zarrMasksBasename,
  zarrRankingsBasename,
  zarrResidualSignalBasename,
  zarrReturnsBasename,
  zarrIndustryBasename,
} from "@/lib/zarr-config";
import { getCache, setCache, CACHE_TTL, generateCacheKey } from "@/lib/cache/redis";
import type { SecurityHistoryRow, V3MetricKey, V3Periodicity } from "./risk-engine-v3";
import { getZarrSpec, ZARR_UNSUPPORTED_DAILY_KEYS } from "./zarr-metric-registry";
import {
  aggregateFactsToLevel,
  factCellsToFactRows,
  factLevelToName,
  IndustryPanelFactAxisUnavailable,
  type IndustryPanelBy,
  type IndustryPanelFactCell,
  type IndustryPanelKey,
  type IndustryPanelLevel,
  type IndustryPanelRow,
  INDUSTRY_PANEL_LEVELS,
} from "@/lib/risk/industry-panel-aggregate";

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
      // Prefer an app-only key path: shells often export GOOGLE_APPLICATION_CREDENTIALS
      // (e.g. from ~/.zshrc) before Next loads .env.local, and dotenv does not override
      // existing process.env keys — Zarr then authenticates with the wrong file.
      const keyFile = process.env.RISKMODELS_GCS_KEYFILE?.trim();
      if (keyFile) {
        _storage = new Storage({ keyFilename: keyFile });
      } else {
        _storage = new Storage();
      }
    }
  }
  return _storage;
}

/** Minimal AsyncReadable for zarrita + consolidated metadata. */
/**
 * In-process chunk cache for zarr object reads. zarr chunks span many
 * symbols per teo-block, so a portfolio slice re-downloads the same chunk
 * once per symbol (18 series reads × ~9 chunks, mostly duplicates), and
 * every `.get` opens a fresh TLS connection. Caching by object name with
 * in-flight promise dedup collapses that to one download per distinct
 * chunk per warm instance. Chunk bytes are written nightly (immutable
 * intra-day), so a 30-minute TTL + small LRU cap is safe.
 */
const ZARR_CHUNK_TTL_MS = 30 * 60 * 1000;
const ZARR_CHUNK_CACHE_MAX = 512;
const zarrChunkCache = new Map<
  string,
  { at: number; promise: Promise<Uint8Array | undefined> }
>();

function zarrChunkCacheGet(
  objectName: string,
): Promise<Uint8Array | undefined> | null {
  const hit = zarrChunkCache.get(objectName);
  if (!hit) return null;
  if (Date.now() - hit.at >= ZARR_CHUNK_TTL_MS) {
    zarrChunkCache.delete(objectName);
    return null;
  }
  // Refresh LRU position.
  zarrChunkCache.delete(objectName);
  zarrChunkCache.set(objectName, hit);
  return hit.promise;
}

function zarrChunkCacheSet(
  objectName: string,
  promise: Promise<Uint8Array | undefined>,
): void {
  zarrChunkCache.set(objectName, { at: Date.now(), promise });
  if (zarrChunkCache.size > ZARR_CHUNK_CACHE_MAX) {
    const oldest = zarrChunkCache.keys().next().value;
    if (oldest !== undefined) zarrChunkCache.delete(oldest);
  }
}

class GcsZarrStore {
  constructor(
    private readonly bucket: Bucket,
    private readonly zarrObjectPrefix: string,
  ) {}

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    const cached = zarrChunkCacheGet(objectName);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const [buf] = await this.bucket.file(objectName).download();
        return new Uint8Array(buf);
      } catch (e: unknown) {
        const err = e as { code?: number };
        if (err?.code === 404) return undefined;
        console.error("[zarr-internal] storage read failed");
        throw new Error("Zarr read failed");
      }
    })();
    // In-flight dedup: concurrent same-chunk reads share this promise.
    zarrChunkCacheSet(objectName, promise);
    // Don't let a transient failure poison the cache for the full TTL.
    promise.catch(() => zarrChunkCache.delete(objectName));
    return promise;
  }
}

async function openZarrGroupUncached(
  objectPrefix: string,
): Promise<Group<Readable> | null> {
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
    if (
      process.env.NODE_ENV === "development" &&
      !process.env.RISKMODELS_GCS_KEYFILE?.trim() &&
      !process.env.GCP_SERVICE_ACCOUNT_JSON?.trim()
    ) {
      console.warn(
        "[zarr-internal] dev hint: set RISKMODELS_GCS_KEYFILE in .env.local to the service-account JSON path so GCS auth wins over a stale shell GOOGLE_APPLICATION_CREDENTIALS.",
      );
    }
    return null;
  }
}

/**
 * In-process zarr group cache. Each `readHistorySlice` used to re-download
 * `.zmetadata` for up to 4 groups per call (and /api/snapshot fires up to 4
 * slices per request). Groups are opened once per warm instance and reused
 * for `GROUP_CACHE_TTL_MS` — zarrs update nightly, so a 30-minute staleness
 * ceiling stays well inside the publish cadence.
 */
const GROUP_CACHE_TTL_MS = 30 * 60 * 1000;
const zarrGroupCache = new Map<
  string,
  { at: number; promise: Promise<Group<Readable> | null> }
>();

async function openZarrGroup(objectPrefix: string): Promise<Group<Readable> | null> {
  const hit = zarrGroupCache.get(objectPrefix);
  if (hit && Date.now() - hit.at < GROUP_CACHE_TTL_MS) return hit.promise;
  const promise = openZarrGroupUncached(objectPrefix);
  zarrGroupCache.set(objectPrefix, { at: Date.now(), promise });
  return promise;
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

    const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
    const units = typeof attrs.units === "string" ? attrs.units : "";
    const cfMatch = units.match(/^days since (\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2})?/);

    // CF-encoded int64 day offsets (preferred encoding for all ERM3 stores)
    if (d instanceof BigInt64Array && cfMatch) {
      const baseMs = Date.parse(`${cfMatch[1]}T00:00:00Z`);
      if (!Number.isFinite(baseMs)) return null;
      const MS_PER_DAY = 86_400_000;
      return Array.from(d, (v) => {
        const t = baseMs + Number(v) * MS_PER_DAY;
        const dt = new Date(t);
        return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : "";
      });
    }

    // datetime64[ns] nanosecond epochs (rankings zarr and legacy stores)
    if (d instanceof BigInt64Array) {
      return Array.from(d, (v) => nsToIsoDate(v));
    }

    // Fallback: numeric array (Int32Array, Float64Array, etc.) treated as ns epochs
    if (ArrayBuffer.isView(d) && !(d instanceof Uint8Array)) {
      const nums = d as unknown as ArrayLike<number>;
      return Array.from(nums, (v) => {
        const ms = Number(v) / 1_000_000;
        const dt = new Date(ms);
        return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : "";
      });
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

/** Read a single (teoIdx, all-symbols) row. Used by the rankings cross-section
 *  reader: `ds_rankings_*` is chunked {teo: 1, symbol: -1}, so this touches
 *  exactly one chunk per variable. */
async function readFloatRowAtTeo(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbol: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nSymbol)]);
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

/** Read a single (teo-slice, symIdx) column from a flat 2D array. Handles
 *  Float32/Float64 (with NaN→null) AND integer typed arrays (Uint8/Int8/
 *  Uint16/Int16/Int32) for companion vars like `lstar_level`. */
async function readNumericSeriesTeoSymbol(
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
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    if (
      d instanceof Uint8Array ||
      d instanceof Int8Array ||
      d instanceof Uint16Array ||
      d instanceof Int16Array ||
      d instanceof Int32Array ||
      d instanceof Uint32Array
    ) {
      return Array.from(d, (x) => x as number);
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

// Phase 0 telemetry for the security_history → pure-Zarr migration. One line
// per readHistorySlice call. Drives the chunk-shape decision in Phase 1 and
// the TeoAggregator scope in Phase 2.5. Remove (or gate behind a flag) once
// the migration lands.
function logSliceTelemetry(
  params: ReadHistorySliceParams,
  outcome: "non_daily_skip" | "unsupported_keys_skip" | "cache_hit" | "open_failed" | "empty_axes" | "served",
  rowCount: number,
  elapsedMs: number,
): void {
  const days =
    params.startDate && params.endDate
      ? Math.max(
          0,
          Math.round(
            (Date.parse(params.endDate) - Date.parse(params.startDate)) / 86_400_000,
          ),
        )
      : null;
  console.log(
    JSON.stringify({
      evt: "zarr_slice",
      outcome,
      symbols: params.symbols.length,
      keys: params.keys.length,
      periodicity: params.periodicity,
      days,
      rows: rowCount,
      ms: elapsedMs,
    }),
  );
}

export async function readHistorySlice(
  params: ReadHistorySliceParams,
): Promise<ReadHistorySliceResult> {
  const _tStart = Date.now();
  const {
    symbols,
    keys,
    periodicity,
    startDate,
    endDate,
    orderBy = "asc",
  } = params;

  if (periodicity !== "daily") {
    logSliceTelemetry(params, "non_daily_skip", 0, Date.now() - _tStart);
    return { rows: [], range: ["", ""] };
  }
  if (shouldUseSupabaseForKeys(keys)) {
    logSliceTelemetry(params, "unsupported_keys_skip", 0, Date.now() - _tStart);
    return { rows: [], range: ["", ""] };
  }

  const ck = cacheKeyForZarr(params);
  const hit = await getCache<ReadHistorySliceResult>(ck);
  // `[]` is truthy in JS — only treat cache as a hit when we stored real rows.
  if (hit?.rows?.length) {
    logSliceTelemetry(params, "cache_hit", hit.rows.length, Date.now() - _tStart);
    return hit;
  }

  // Daily store is always opened. Hedge/returns are opened lazily only if
  // the requested key set actually touches them — avoids a pointless GCS
  // round-trip on vanilla returns/price queries.
  const dailyGrp = await openZarrGroup(zarrDailyBasename());
  if (!dailyGrp) {
    logSliceTelemetry(params, "open_failed", 0, Date.now() - _tStart);
    return { rows: [], range: ["", ""] };
  }
  const dailyTeo = await readTeoStrings(dailyGrp);
  const dailySymMap = await readSymbolIndexMap(dailyGrp);
  if (!dailyTeo?.length || !dailySymMap?.size) {
    logSliceTelemetry(params, "empty_axes", 0, Date.now() - _tStart);
    return { rows: [], range: ["", ""] };
  }

  const needHedge = keys.some((k) => getZarrSpec(k)?.role === "hedge");
  const needReturns = keys.some((k) => {
    const r = getZarrSpec(k)?.role;
    return r === "returns" || r === "returnsFlat";
  });

  const hedgeGrp = needHedge ? await openZarrGroup(zarrHedgeBasename()) : null;
  const hedgeTeo = hedgeGrp ? await readTeoStrings(hedgeGrp) : null;
  const hedgeSymMap = hedgeGrp ? await readSymbolIndexMap(hedgeGrp) : null;

  const returnsGrp = needReturns ? await openZarrGroup(zarrReturnsBasename()) : null;
  const returnsTeo = returnsGrp ? await readTeoStrings(returnsGrp) : null;
  const returnsSymMap = returnsGrp ? await readSymbolIndexMap(returnsGrp) : null;
  const levelMaps = returnsGrp ? await readLevelIndexMap(returnsGrp) : null;

  // ETF store. Disjoint from ds_daily — ~100 ETFs with their own CUSIP-based // licensed-id-ok: comment explains internal bw_sym_id derivation; no CUSIP value exposed
  // bw_sym_ids (e.g. SPY = BW-US78462F1030). Always opened because the
  // caller's symbol list can contain a mix of stocks and ETFs and we can't
  // tell which is which upfront without a Supabase round-trip. The store is
  // small (100 symbols) so the cost of an unneeded open is negligible.
  // ETFs don't decompose into factor exposures, so hedge/returns roles are
  // skipped for ETF symbols — the existing per-store symMap guards enforce
  // that automatically.
  const etfGrp = await openZarrGroup(zarrEtfBasename());
  const etfTeo = etfGrp ? await readTeoStrings(etfGrp) : null;
  const etfSymMap = etfGrp ? await readSymbolIndexMap(etfGrp) : null;

  // Shortest common range across every stock-side store involved in this
  // request, clipped to the caller's [startDate, endDate] window. Guarantees
  // stock-symbol rows only appear inside a date window that all requested
  // stock stores cover — no misleading half-populated rows. Each store's teo
  // is sorted ascending, so we max the firsts and min the lasts.
  //
  // ETF store is intentionally excluded from this intersection: ETF queries
  // are disjoint from stock queries (no hedge/returns involvement), so
  // narrowing the stock window by the ETF store's coverage would needlessly
  // clip stock queries that don't touch any ETF.
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

  // ETF bounds are computed independently against the ETF store's own teo
  // axis, clipped only by the caller's [startDate, endDate] — NOT by the
  // stock-side common window. This lets a pure-ETF query return its full
  // coverage even if (for example) the returns store's teo starts later
  // than the ETF store's.
  let etfT0 = 0;
  let etfT1 = 0;
  if (etfGrp && etfTeo?.length) {
    const etfStart = startDate && startDate > etfTeo[0]! ? startDate : etfTeo[0]!;
    const etfEnd =
      endDate && endDate < etfTeo[etfTeo.length - 1]!
        ? endDate
        : etfTeo[etfTeo.length - 1]!;
    if (etfStart <= etfEnd) {
      etfT0 = lowerBound(etfTeo, etfStart);
      etfT1 = upperBoundInclusive(etfTeo, etfEnd);
      if (etfT1 < etfT0) etfT1 = etfT0;
    }
  }

  const rangeStart = validWindow ? (dailyTeo[dt0] ?? effStart) : "";
  const rangeEnd = validWindow ? (dailyTeo[Math.max(0, dt1 - 1)] ?? effEnd) : "";

  // One independent read per (symbol, key) pair. The body is unchanged from
  // the old sequential loop — only `continue` became `return rows` and the
  // pair's rows collect into a local array.
  const readOne = async (
    symbol: string,
    key: V3MetricKey,
    idxs: {
      dailyIdx: number | undefined;
      etfIdx: number | undefined;
      hedgeIdx: number | undefined;
      returnsIdx: number | undefined;
    },
  ): Promise<SecurityHistoryRow[]> => {
    const rows: SecurityHistoryRow[] = [];
    const { dailyIdx, etfIdx, hedgeIdx, returnsIdx } = idxs;
    const spec = getZarrSpec(key);
    if (!spec) return rows;

    if (spec.role === "daily") {
      // Stock path first.
      if (dailyIdx !== undefined && dt1 > dt0) {
        const vals = await readFloatSeriesTeoSymbol(
          dailyGrp,
          spec.zarrVar,
          dt0,
          dt1,
          dailyIdx,
        );
        if (vals) {
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
          return rows;
        }
      }
      // ETF path fallback: only if the symbol wasn't in ds_daily at all
      // (so we don't double-read for a symbol that just happens to have
      // an empty daily series for some reason).
      if (
        dailyIdx === undefined &&
        etfGrp &&
        etfIdx !== undefined &&
        etfTeo?.length &&
        etfT1 > etfT0
      ) {
        const vals = await readFloatSeriesTeoSymbol(
          etfGrp,
          spec.zarrVar,
          etfT0,
          etfT1,
          etfIdx,
        );
        if (vals) {
          for (let i = 0; i < vals.length; i++) {
            const teoStr = etfTeo[etfT0 + i];
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
      return rows;
    }

    if (spec.role === "hedge") {
      if (!hedgeGrp || hedgeIdx === undefined || !hedgeTeo || ht1 <= ht0) return rows;
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
      if (!raw) return rows;
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
      return rows;
    }

    if (spec.role === "returns") {
      if (
        !returnsGrp ||
        returnsIdx === undefined ||
        !returnsTeo ||
        !levelMaps ||
        rt1 <= rt0
      ) return rows;
      const li = levelMaps.get(spec.level);
      if (li === undefined) return rows;
      const vals = await readFloatSeriesTeoSymbolLevel(
        returnsGrp,
        spec.zarrVar,
        rt0,
        rt1,
        returnsIdx,
        li,
      );
      if (!vals) return rows;
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
      return rows;
    }

    if (spec.role === "returnsFlat") {
      if (
        !returnsGrp ||
        returnsIdx === undefined ||
        !returnsTeo ||
        rt1 <= rt0
      ) return rows;
      const vals = await readNumericSeriesTeoSymbol(
        returnsGrp,
        spec.zarrVar,
        rt0,
        rt1,
        returnsIdx,
      );
      if (!vals) return rows;
      const sentinel = spec.nullSentinel;
      for (let i = 0; i < vals.length; i++) {
        const teoStr = returnsTeo[rt0 + i];
        if (!teoStr) continue;
        const v = vals[i];
        const mv = (v != null && sentinel !== undefined && v === sentinel) ? null : v ?? null;
        rows.push({
          symbol,
          teo: teoStr,
          periodicity: "daily",
          metric_key: key,
          metric_value: mv,
        });
      }
    }
    return rows;
  };

  const tasks: Array<() => Promise<SecurityHistoryRow[]>> = [];
  for (const symbol of symbols) {
    // Each store has its OWN symbol roster and ordering. Resolve per store.
    // ETFs live in ds_etf.zarr and are NOT present in ds_daily — the daily-
    // role branch below falls through to the ETF store when `dailyIdx` is
    // undefined but `etfIdx` resolves. Hedge/returns branches intentionally
    // skip ETFs (they don't decompose into factor exposures).
    const dailyIdx = dailySymMap.get(symbol);
    const etfIdx = etfSymMap?.get(symbol);
    const hedgeIdx = hedgeSymMap?.get(symbol);
    const returnsIdx = returnsSymMap?.get(symbol);

    for (const key of keys) {
      tasks.push(() =>
        readOne(symbol, key, { dailyIdx, etfIdx, hedgeIdx, returnsIdx }),
      );
    }
  }

  // Bounded-parallel chunk reads: 20 tickers × 6 keys = 120 independent
  // GCS round-trips that used to run strictly sequentially — the dominant
  // /api/snapshot latency. A small worker pool keeps GCS pressure bounded;
  // the rows.sort below makes output order deterministic regardless of
  // task completion order. Env-tunable for ops (1 = old sequential behavior).
  const ZARR_READ_CONCURRENCY = Math.max(
    1,
    Number(process.env.ZARR_READ_CONCURRENCY ?? 8) || 8,
  );
  const rows: SecurityHistoryRow[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(ZARR_READ_CONCURRENCY, tasks.length) },
      async () => {
        while (cursor < tasks.length) {
          const part = await tasks[cursor++]();
          rows.push(...part);
        }
      },
    ),
  );

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

  logSliceTelemetry(params, "served", rows.length, Date.now() - _tStart);
  return result;
}

// =====================================================================
// Rankings: latest-teo cross-section reader
// =====================================================================
//
// `ds_rankings_*` is a flat (teo, symbol) store with one variable per
// (window, cohort, metric) combo. Variable names match the legacy Supabase
// EAV `metric_key` exactly: `rank_ord_{window}_{cohort}_{metric}` and
// `cohort_size_{window}_{cohort}_{metric}`. Chunked {teo: 1, symbol: -1},
// so reading "all symbols at the latest teo for one rank variable" touches
// exactly one chunk (~12KB at ~3000 symbols × float32).

export interface RankingSnapshotRow {
  symbol: string;
  rank_ordinal: number;
  cohort_size: number | null;
}

export interface ReadLatestRankSnapshotResult {
  teo: string | null;
  rows: RankingSnapshotRow[];
}

/**
 * Full cross-section for one ranking variable at one teo. `prefix` is the
 * `{window}_{cohort}_{metric}` triple — reads `rank_ord_${prefix}` and
 * `cohort_size_${prefix}`. When `teo` is omitted, uses the latest date in
 * the store (same as GET /rankings/top).
 */
export async function readRankingsCrossSection(
  prefix: string,
  options?: { teo?: string },
): Promise<ReadLatestRankSnapshotResult> {
  const rankVar = `rank_ord_${prefix}`;
  const cohortVar = `cohort_size_${prefix}`;

  const grp = await openZarrGroup(zarrRankingsBasename());
  if (!grp) return { teo: null, rows: [] };

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return { teo: null, rows: [] };

  const symMap = await readSymbolIndexMap(grp);
  if (!symMap?.size) return { teo: null, rows: [] };
  const symByIndex: string[] = new Array(symMap.size);
  for (const [sym, idx] of symMap) symByIndex[idx] = sym;
  const nSymbol = symByIndex.length;

  const teoIdx = resolveTeoIndex(teos, options?.teo);
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return { teo: null, rows: [] };

  const rankRow = await readFloatRowAtTeo(grp, rankVar, teoIdx, nSymbol);
  if (!rankRow) {
    return { teo: teoStr, rows: [] };
  }

  const candidates: { symbol: string; rank: number; idx: number }[] = [];
  for (let i = 0; i < nSymbol; i++) {
    const v = rankRow[i];
    if (v == null || !Number.isFinite(v)) continue;
    const r = Math.round(v);
    if (r < 1) continue;
    const sym = symByIndex[i];
    if (!sym) continue;
    candidates.push({ symbol: sym, rank: r, idx: i });
  }
  if (candidates.length === 0) return { teo: teoStr, rows: [] };

  candidates.sort((a, b) => a.rank - b.rank);

  const cohortRow = await readFloatRowAtTeo(grp, cohortVar, teoIdx, nSymbol);
  const rows: RankingSnapshotRow[] = candidates.map((c) => {
    const cs = cohortRow?.[c.idx];
    return {
      symbol: c.symbol,
      rank_ordinal: c.rank,
      cohort_size: cs != null && Number.isFinite(cs) ? Math.round(cs) : null,
    };
  });

  return { teo: teoStr, rows };
}

/**
 * Read the top-K symbols for one ranking variable at the latest teo in the
 * rankings store. `prefix` is the `{window}_{cohort}_{metric}` triple that
 * the API constructs from request params — the function looks up
 * `rank_ord_${prefix}` and `cohort_size_${prefix}` as Zarr variables.
 *
 * Returns rank 1 = best (lowest ordinal) and percentile-friendly rows;
 * the caller is responsible for any symbol→ticker resolution and the
 * percentile derivation, mirroring the legacy Supabase path.
 */
export async function readLatestRankSnapshot(
  prefix: string,
  limit: number,
): Promise<ReadLatestRankSnapshotResult> {
  const cap = Math.min(100, Math.max(1, Math.floor(limit)));
  const snapshot = await readRankingsCrossSection(prefix);
  if (!snapshot.teo || snapshot.rows.length === 0) {
    return snapshot;
  }
  return { teo: snapshot.teo, rows: snapshot.rows.slice(0, cap) };
}

// =====================================================================
// Link-betas: latest-teo lookup for the cascade hedge basket
// =====================================================================
//
// `ds_erm3_link_betas_{marketFactorEtf}.zarr` carries ETF-to-ETF betas:
//   L2_link_sec_mkt_BF  — sector ETF's slope on SPY (λ_s→m)
//   L3_link_sub_mkt_BF  — subsector ETF's slope on SPY (λ_u→m)
//   L3_link_sub_sec_BF  — subsector ETF's slope on the sector ETF (λ_u→s)
// Indexed (teo, symbol) over ~51 ETFs with `ticker` as an extra string coord.
// The hedge-basket endpoint reads three cells per call: λ_s→m at the sector
// ETF's index, λ_u→m + λ_u→s at the subsector ETF's index. SPY itself is the
// market root by convention, so λ_*→SPY = 1.0 and never reads from this store.

async function readTickerIndexMap(grp: Group<Readable>): Promise<Map<string, number> | null> {
  // Recycled-ticker collision policy: prefer the collision-free `unique_ticker`
  // coord when the store carries one (bare ticker = canonical current holder,
  // 'X#N' = prior holder); on the display `ticker` coord keep the FIRST
  // symbol-axis occurrence and warn — never silent last-wins.
  const readCoordMap = async (coordName: string): Promise<Map<string, number> | null> => {
    try {
      const loc = grp.resolve(coordName);
      const arr = await open.v2(loc, { kind: "array" });
      const ch = await get(arr, null);
      const d = ch?.data;
      const at =
        d instanceof UnicodeStringArray
          ? (i: number) => String(d.get(i)).trim().toUpperCase()
          : Array.isArray(d)
            ? (i: number) => String(d[i]).trim().toUpperCase()
            : null;
      if (!at) return null;
      const n = (d as { length: number }).length;
      const m = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const t = at(i);
        if (m.has(t)) {
          console.warn(
            `[zarr-reader] Duplicate ${coordName} ${t} at symbol indexes ${m.get(t)}, ${i} — keeping first`,
          );
          continue;
        }
        m.set(t, i);
      }
      return m;
    } catch {
      return null;
    }
  };
  return (await readCoordMap("unique_ticker")) ?? (await readCoordMap("ticker"));
}

async function readFloatScalarTeoSymbol(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  symIdx: number,
): Promise<number | null> {
  // Slice with a 1-element teo range to get a typed-array result (zarrita's
  // scalar-indexed get returns a 0-d type that TS doesn't surface `.data` for).
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [slice(teoIdx, teoIdx + 1), symIdx]);
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

export interface LatestLinkBetas {
  teo: string;
  /** Sector ETF's slope on SPY. Null if the sector ETF isn't in the store. */
  lambda_s_to_m: number | null;
  /** Subsector ETF's slope on SPY. Null if absent. */
  lambda_u_to_m: number | null;
  /** Subsector ETF's slope on the sector ETF. Null if absent. */
  lambda_u_to_s: number | null;
}

/**
 * Read the latest-teo link-betas for a given (sector_etf, subsector_etf) pair.
 *
 * - Ticker matching is case-insensitive against the ETF roster in the link-betas
 *   zarr (~51 ETFs).
 * - If either ticker resolves to "SPY", the corresponding lambda is implicitly
 *   1.0 (sector_etf=SPY) or 0.0 (subsector→sector when subsector_etf=SPY), and
 *   no zarr read is needed for that leg. The caller can apply that convention
 *   without checking — this function only returns store-derived values.
 * - Returns null if the store can't be opened or the latest teo is empty.
 */
export async function readLatestLinkBetas(
  sectorEtfTicker: string | null,
  subsectorEtfTicker: string | null,
  marketFactorEtf = "SPY",
): Promise<LatestLinkBetas | null> {
  const grp = await openZarrGroup(zarrLinkBetasBasename(marketFactorEtf));
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return null;
  const teoIdx = teos.length - 1;
  const teoStr = teos[teoIdx]!;

  const tickerMap = await readTickerIndexMap(grp);
  if (!tickerMap?.size) return null;

  const secIdx = sectorEtfTicker ? tickerMap.get(sectorEtfTicker.toUpperCase()) : undefined;
  const subIdx = subsectorEtfTicker ? tickerMap.get(subsectorEtfTicker.toUpperCase()) : undefined;

  // Parallelize the three single-cell reads. NaN-safe via Float32Array unpacking.
  const [lam_s_m, lam_u_m, lam_u_s] = await Promise.all([
    secIdx !== undefined
      ? readFloatScalarTeoSymbol(grp, "L2_link_sec_mkt_BF", teoIdx, secIdx)
      : Promise.resolve(null),
    subIdx !== undefined
      ? readFloatScalarTeoSymbol(grp, "L3_link_sub_mkt_BF", teoIdx, subIdx)
      : Promise.resolve(null),
    subIdx !== undefined
      ? readFloatScalarTeoSymbol(grp, "L3_link_sub_sec_BF", teoIdx, subIdx)
      : Promise.resolve(null),
  ]);

  return {
    teo: teoStr,
    lambda_s_to_m: lam_s_m,
    lambda_u_to_m: lam_u_m,
    lambda_u_to_s: lam_u_s,
  };
}

export interface SymbolRankResult {
  /** `{window}_{cohort}_{metric}` triple — caller-facing key for the result map. */
  prefix: string;
  rank_ordinal: number | null;
  cohort_size: number | null;
}

export interface ReadSymbolRankSnapshotResult {
  teo: string | null;
  results: SymbolRankResult[];
}

/**
 * Per-symbol rankings: for one symbol at the latest teo in the rankings
 * store, return rank_ordinal and cohort_size for each requested
 * `(window, cohort, metric)` prefix. Used by the per-symbol rankings
 * endpoint where the API needs to surface "this stock's rank in every
 * combo," even when the stock isn't in the top-K of any particular slice.
 *
 * Implementation: issues 2 × prefixes.length parallel chunk fetches (one
 * for each of `rank_ord_${prefix}` and `cohort_size_${prefix}`). With the
 * `{teo: 1, symbol: -1}` chunk shape each fetch is exactly one chunk
 * (~12KB), so the network cost is dominated by GCS round-trip latency.
 * Variables that don't exist in the store (e.g. PIT-only metrics under a
 * non-1d window: `rank_ord_252d_universe_mkt_cap` is never written) are
 * returned as nulls — matches the prior Supabase-EAV behavior of "row not
 * present."
 */
export async function readSymbolRankSnapshot(
  symbol: string,
  prefixes: string[],
): Promise<ReadSymbolRankSnapshotResult> {
  if (prefixes.length === 0) return { teo: null, results: [] };

  const grp = await openZarrGroup(zarrRankingsBasename());
  if (!grp) return { teo: null, results: [] };

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return { teo: null, results: [] };

  const symMap = await readSymbolIndexMap(grp);
  if (!symMap?.size) return { teo: null, results: [] };
  const nSymbol = symMap.size;

  const symIdx = symMap.get(symbol);
  const teoIdx = teos.length - 1;
  const teoStr = teos[teoIdx] ?? null;

  // Symbol not in the rankings universe (e.g. an ETF, or a stock outside
  // uni_mc_3000). Return the teo so callers can still surface "no rankings
  // for this symbol at $teo" rather than a generic null.
  if (symIdx === undefined || !teoStr) {
    return {
      teo: teoStr,
      results: prefixes.map((prefix) => ({
        prefix,
        rank_ordinal: null,
        cohort_size: null,
      })),
    };
  }

  // Issue all reads in parallel. The Google Cloud Storage client library
  // pools connections internally, so we don't need to gate concurrency
  // explicitly for the ~200-fetch budget here.
  const reads = await Promise.all(
    prefixes.flatMap((prefix) => [
      readFloatRowAtTeo(grp, `rank_ord_${prefix}`, teoIdx, nSymbol),
      readFloatRowAtTeo(grp, `cohort_size_${prefix}`, teoIdx, nSymbol),
    ]),
  );

  const results: SymbolRankResult[] = prefixes.map((prefix, i) => {
    const rRow = reads[i * 2];
    const cRow = reads[i * 2 + 1];
    const rRaw = rRow?.[symIdx];
    const cRaw = cRow?.[symIdx];
    const rank_ordinal =
      rRaw != null && Number.isFinite(rRaw) && rRaw >= 1
        ? Math.round(rRaw)
        : null;
    const cohort_size =
      cRaw != null && Number.isFinite(cRaw) && cRaw > 0
        ? Math.round(cRaw)
        : null;
    return { prefix, rank_ordinal, cohort_size };
  });

  return { teo: teoStr, results };
}

// =====================================================================
// Residual mean-reversion signal (Phase D)
// =====================================================================
//
// `ds_erm3_residual_signal_{factorSetId}.zarr` is a flat (teo, symbol) store
// with seven float32 variables — see erm3/core/residual_signal.py. Chunked
// {teo: 500, symbol: 1000}. Carries a `ticker` string coord so tickers
// resolve in-zarr without a Supabase round-trip.

const RESIDUAL_SIGNAL_VARS = [
  "residual_z_5d",
  "signal_strength",
  "decile_rank",
  "industry_percentile",
  "residual_autocorr_5d",
  "l3_subsector_er",
  "signal_quality_quintile",
] as const;

export interface ResidualSignalPoint {
  date: string;
  residual_z_5d: number | null;
  signal_strength: number | null;
  decile_rank: number | null;
  industry_percentile: number | null;
  residual_autocorr_5d: number | null;
  l3_subsector_er: number | null;
  signal_quality_quintile: number | null;
}

export interface ResidualSignalSeriesResult {
  ticker: string;
  points: ResidualSignalPoint[];
  range: [string, string];
}

export interface ResidualSignalSnapshotRow {
  ticker: string;
  residual_z_5d: number | null;
  signal_strength: number | null;
  decile_rank: number | null;
  industry_percentile: number | null;
  residual_autocorr_5d: number | null;
  l3_subsector_er: number | null;
  signal_quality_quintile: number | null;
}

export interface ResidualSignalSnapshotResult {
  teo: string | null;
  rows: ResidualSignalSnapshotRow[];
}

/** Build idx→ticker from the zarr's `ticker` coord. */
async function readTickerByIndex(grp: Group<Readable>): Promise<string[] | null> {
  try {
    const loc = grp.resolve("ticker");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      return Array.from({ length: d.length }, (_, i) => String(d.get(i)).trim());
    }
    if (Array.isArray(d)) {
      return d.map((x) => String(x).trim());
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Per-ticker residual-signal time series. Resolves the ticker against the
 * store's own `ticker` coord (case-insensitive). Returns up to the
 * [startDate, endDate] window — caller passes a 90d window for the API
 * snapshot+history shape. Null if the store is unavailable or the ticker
 * isn't in the universe.
 */
export async function readResidualSignalSeries(
  ticker: string,
  startDate?: string,
  endDate?: string,
): Promise<ResidualSignalSeriesResult | null> {
  const grp = await openZarrGroup(zarrResidualSignalBasename());
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return null;

  const tickerMap = await readTickerIndexMap(grp);
  if (!tickerMap?.size) return null;
  const symIdx = tickerMap.get(ticker.trim().toUpperCase());
  if (symIdx === undefined) return null;

  const t0 = startDate ? lowerBound(teos, startDate) : 0;
  const t1 = endDate ? upperBoundInclusive(teos, endDate) : teos.length;
  if (t1 <= t0) {
    return { ticker: ticker.toUpperCase(), points: [], range: ["", ""] };
  }

  const series = await Promise.all(
    RESIDUAL_SIGNAL_VARS.map((v) =>
      readFloatSeriesTeoSymbol(grp, v, t0, t1, symIdx),
    ),
  );

  const points: ResidualSignalPoint[] = [];
  for (let i = 0; i < t1 - t0; i++) {
    const date = teos[t0 + i];
    if (!date) continue;
    points.push({
      date,
      residual_z_5d: series[0]?.[i] ?? null,
      signal_strength: series[1]?.[i] ?? null,
      decile_rank: series[2]?.[i] ?? null,
      industry_percentile: series[3]?.[i] ?? null,
      residual_autocorr_5d: series[4]?.[i] ?? null,
      l3_subsector_er: series[5]?.[i] ?? null,
      signal_quality_quintile: series[6]?.[i] ?? null,
    });
  }

  return {
    ticker: ticker.toUpperCase(),
    points,
    range: [teos[t0] ?? "", teos[t1 - 1] ?? ""],
  };
}

/**
 * Full active-universe residual-signal cross-section at the latest teo.
 * Backs both /api/residual-signal/latest and /api/residual-signal/decile/{n}
 * (the route filters by decile_rank). One chunk-row read per variable.
 */
export async function readResidualSignalLatest(): Promise<ResidualSignalSnapshotResult> {
  const grp = await openZarrGroup(zarrResidualSignalBasename());
  if (!grp) return { teo: null, rows: [] };

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return { teo: null, rows: [] };
  const teoIdx = teos.length - 1;
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return { teo: null, rows: [] };

  const symMap = await readSymbolIndexMap(grp);
  const tickerByIndex = await readTickerByIndex(grp);
  if (!symMap?.size || !tickerByIndex?.length) return { teo: teoStr, rows: [] };
  const nSymbol = symMap.size;

  const rowsByVar = await Promise.all(
    RESIDUAL_SIGNAL_VARS.map((v) => readFloatRowAtTeo(grp, v, teoIdx, nSymbol)),
  );

  const rows: ResidualSignalSnapshotRow[] = [];
  for (let i = 0; i < nSymbol; i++) {
    const z = rowsByVar[0]?.[i] ?? null;
    // Skip symbols with no signal at this teo (inactive / insufficient history).
    if (z == null) continue;
    const ticker = tickerByIndex[i];
    if (!ticker) continue;
    rows.push({
      ticker,
      residual_z_5d: z,
      signal_strength: rowsByVar[1]?.[i] ?? null,
      decile_rank: rowsByVar[2]?.[i] ?? null,
      industry_percentile: rowsByVar[3]?.[i] ?? null,
      residual_autocorr_5d: rowsByVar[4]?.[i] ?? null,
      l3_subsector_er: rowsByVar[5]?.[i] ?? null,
      signal_quality_quintile: rowsByVar[6]?.[i] ?? null,
    });
  }

  return { teo: teoStr, rows };
}

// =====================================================================
// Industry panel — cross-section at (teo × fs_industry_code × level|fact)
// =====================================================================

export {
  INDUSTRY_PANEL_LEVELS,
  IndustryPanelFactAxisUnavailable,
};
export type {
  IndustryPanelBy,
  IndustryPanelKey,
  IndustryPanelLevel,
  IndustryPanelRow,
};

const INDUSTRY_PANEL_VARS = [
  "beta_mean",
  "beta_variance",
  "n_companies",
  "total_log_mcap_weight",
] as const;

export interface ReadIndustryPanelResult {
  teo: string | null;
  rows: IndustryPanelRow[];
  min_peers: number;
  by: IndustryPanelBy;
  /** Store vintage: `level` = pre-rekey collapse, `fact` = per-fact axis. */
  panel_key: IndustryPanelKey;
}

async function readIndustryCodeInts(grp: Group<Readable>): Promise<number[] | null> {
  try {
    const loc = grp.resolve("fs_industry_code");
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof Int16Array) {
      return Array.from(d, (x) => Number(x));
    }
    if (d instanceof Int32Array || d instanceof Uint16Array) {
      return Array.from(d, (x) => Number(x));
    }
    if (ArrayBuffer.isView(d) && !(d instanceof Uint8Array)) {
      return Array.from(d as unknown as ArrayLike<number>, (x) => Number(x));
    }
    return null;
  } catch {
    return null;
  }
}

async function readStringCoord(
  grp: Group<Readable>,
  name: string,
): Promise<string[] | null> {
  try {
    const loc = grp.resolve(name);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      return Array.from({ length: d.length }, (_, i) => String(d.get(i)).trim());
    }
    if (Array.isArray(d)) {
      return d.map((x) => String(x).trim());
    }
    return null;
  } catch {
    return null;
  }
}

async function readIntCoord(
  grp: Group<Readable>,
  name: string,
): Promise<number[] | null> {
  try {
    const loc = grp.resolve(name);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (
      d instanceof Int8Array ||
      d instanceof Int16Array ||
      d instanceof Int32Array ||
      d instanceof Uint8Array ||
      d instanceof Uint16Array ||
      d instanceof Uint32Array ||
      d instanceof Float32Array ||
      d instanceof Float64Array
    ) {
      return Array.from(d, (x) => Number(x));
    }
    if (Array.isArray(d)) {
      return d.map((x) => Number(x));
    }
    return null;
  } catch {
    return null;
  }
}

async function readFloatRowAtTeoIndustryLevel(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  levelIdx: number,
  nIndustry: number,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nIndustry), levelIdx]);
    const d = ch?.data;
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (x) => (Number.isFinite(x) ? x : null));
    }
    return null;
  } catch {
    return null;
  }
}

/** One teo × all industries × all k (level or fact). C-order: k fastest. */
async function readFloatPlaneAtTeoIndustryK(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nIndustry: number,
  nK: number,
): Promise<(number | null)[][] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nIndustry), slice(0, nK)]);
    const d = ch?.data;
    if (!(d instanceof Float32Array || d instanceof Float64Array)) return null;
    if (d.length !== nIndustry * nK) return null;
    const out: (number | null)[][] = [];
    for (let i = 0; i < nIndustry; i++) {
      const row: (number | null)[] = [];
      for (let k = 0; k < nK; k++) {
        const v = d[i * nK + k];
        row.push(v != null && Number.isFinite(v) ? v : null);
      }
      out.push(row);
    }
    return out;
  } catch {
    return null;
  }
}

function resolveTeoIndex(teos: string[], teo?: string): number {
  if (!teo) return teos.length - 1;
  const exact = teos.indexOf(teo);
  if (exact >= 0) return exact;
  const prior = upperBoundInclusive(teos, teo) - 1;
  return prior >= 0 ? prior : teos.length - 1;
}

function readMinPeersAttr(grp: Group<Readable>): number {
  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const raw = attrs.min_peers;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 5;
}

function emptyIndustryPanel(
  params: { minPeers?: number; by?: IndustryPanelBy },
  panel_key: IndustryPanelKey,
): ReadIndustryPanelResult {
  return {
    teo: null,
    rows: [],
    min_peers: params.minPeers ?? 5,
    by: params.by ?? "level",
    panel_key,
  };
}

function collectFactCells(args: {
  industryCodes: number[];
  factTickers: string[];
  factLevels: number[];
  planes: ((number | null)[][] | null)[];
  minPeers: number;
  levelFilter?: IndustryPanelLevel;
}): IndustryPanelFactCell[] {
  const { industryCodes, factTickers, factLevels, planes, minPeers, levelFilter } = args;
  const nIndustry = industryCodes.length;
  const nFact = factTickers.length;
  const cells: IndustryPanelFactCell[] = [];
  const meanPlane = planes[0];
  if (!meanPlane) return cells;

  for (let k = 0; k < nFact; k++) {
    const levelName = factLevelToName(factLevels[k] ?? NaN);
    if (!levelName) continue;
    if (levelFilter && levelName !== levelFilter) continue;
    const fact = factTickers[k];
    if (!fact) continue;

    for (let i = 0; i < nIndustry; i++) {
      const nCo = planes[2]?.[i]?.[k];
      if (nCo == null || !Number.isFinite(nCo)) continue;
      const peerCount = Math.round(nCo);
      if (peerCount < minPeers) continue;
      const betaMean = meanPlane[i]?.[k] ?? null;
      if (betaMean == null) continue;
      cells.push({
        industry_code: industryCodes[i]!,
        level: levelName,
        fact,
        beta_mean: betaMean,
        beta_variance: planes[1]?.[i]?.[k] ?? null,
        n_companies: peerCount,
        total_log_mcap_weight: planes[3]?.[i]?.[k] ?? null,
      });
    }
  }
  return cells;
}

/**
 * Industry peer β cross-section at one teo.
 *
 * Dual-shape: a level-keyed vintage (pre-rekey) is one row per
 * (industry, level). A fact-keyed vintage keeps that contract on
 * `by=level` via a documented n-weighted collapse, and emits one row
 * per (industry, fact) on `by=fact`.
 */
export async function readIndustryPanelSnapshot(params: {
  teo?: string;
  level?: IndustryPanelLevel;
  minPeers?: number;
  by?: IndustryPanelBy;
}): Promise<ReadIndustryPanelResult> {
  const by: IndustryPanelBy = params.by ?? "level";
  const grp = await openZarrGroup(zarrIndustryBasename());
  if (!grp) return emptyIndustryPanel(params, "level");

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return emptyIndustryPanel(params, "level");

  const industryCodes = await readIndustryCodeInts(grp);
  if (!industryCodes?.length) return emptyIndustryPanel(params, "level");

  const teoIdx = resolveTeoIndex(teos, params.teo);
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return emptyIndustryPanel(params, "level");

  const defaultMinPeers = readMinPeersAttr(grp);
  const minPeers = params.minPeers ?? defaultMinPeers;
  const nIndustry = industryCodes.length;

  const factTickers = await readStringCoord(grp, "fact");
  const factLevels = factTickers ? await readIntCoord(grp, "fact_level") : null;
  const factKeyed =
    Boolean(factTickers?.length) &&
    Boolean(factLevels?.length) &&
    factTickers!.length === factLevels!.length;

  if (factKeyed) {
    const nFact = factTickers!.length;
    const planes = await Promise.all(
      INDUSTRY_PANEL_VARS.map((v) =>
        readFloatPlaneAtTeoIndustryK(grp, v, teoIdx, nIndustry, nFact),
      ),
    );
    const cells = collectFactCells({
      industryCodes,
      factTickers: factTickers!,
      factLevels: factLevels!,
      planes,
      minPeers,
      levelFilter: params.level,
    });
    const rows =
      by === "fact" ? factCellsToFactRows(cells) : aggregateFactsToLevel(cells);
    return { teo: teoStr, rows, min_peers: minPeers, by, panel_key: "fact" };
  }

  if (by === "fact") {
    throw new IndustryPanelFactAxisUnavailable();
  }

  const levelMap = await readLevelIndexMap(grp);
  if (!levelMap?.size) return emptyIndustryPanel(params, "level");

  const levels: IndustryPanelLevel[] = params.level
    ? [params.level]
    : [...INDUSTRY_PANEL_LEVELS];

  const rows: IndustryPanelRow[] = [];

  for (const levelName of levels) {
    const levelIdx = levelMap.get(levelName);
    if (levelIdx === undefined) continue;

    const planes = await Promise.all(
      INDUSTRY_PANEL_VARS.map((v) =>
        readFloatRowAtTeoIndustryLevel(grp, v, teoIdx, levelIdx, nIndustry),
      ),
    );
    if (!planes[0]) continue;

    for (let i = 0; i < nIndustry; i++) {
      const nCo = planes[2]?.[i];
      if (nCo == null || !Number.isFinite(nCo)) continue;
      const peerCount = Math.round(nCo);
      if (peerCount < minPeers) continue;

      const betaMean = planes[0]?.[i] ?? null;
      if (betaMean == null) continue;

      rows.push({
        industry_code: industryCodes[i]!,
        level: levelName,
        beta_mean: betaMean,
        beta_variance: planes[1]?.[i] ?? null,
        n_companies: peerCount,
        total_log_mcap_weight: planes[3]?.[i] ?? null,
        n_facts: 1,
      });
    }
  }

  rows.sort((a, b) => {
    const lc = a.level.localeCompare(b.level);
    if (lc !== 0) return lc;
    return a.industry_code - b.industry_code;
  });

  return { teo: teoStr, rows, min_peers: minPeers, by, panel_key: "level" };
}

// ============================================================================
// Universe membership (R.8 — GET /api/universe/{name}/members)
// ============================================================================

/** Read one (teo, all-symbols) row from a bool-stored mask. Zarr v2 stores
 *  bool as Uint8 (0/1); decode to true/false. */
async function readBoolRowAtTeo(
  grp: Group<Readable>,
  varName: string,
  teoIdx: number,
  nSymbol: number,
): Promise<boolean[] | null> {
  try {
    const loc = grp.resolve(varName);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, [teoIdx, slice(0, nSymbol)]);
    const d = ch?.data;
    if (
      d instanceof Uint8Array ||
      d instanceof Int8Array ||
      d instanceof Uint16Array ||
      d instanceof Int16Array ||
      d instanceof Int32Array
    ) {
      return Array.from(d, (v) => Boolean(v));
    }
    // Some encoders emit Float32 0/1 for bool dtype. Treat any nonzero as true.
    if (d instanceof Float32Array || d instanceof Float64Array) {
      return Array.from(d, (v) => Number.isFinite(v) && v !== 0);
    }
    return null;
  } catch {
    return null;
  }
}

export interface UniverseMember {
  symbol: string;
  ticker: string;
}

export interface UniverseMembersCounts {
  /** Active set: mask AND validity at the requested teo. */
  active: number;
  /** Members of the monthly universe mask before applying daily validity. */
  in_universe_mask: number;
  /** Symbols that pass the universe gate but fail the daily validity gate. */
  inactive_from_validity: number;
}

export interface UniverseMembersResult {
  universe: string;
  teo: string;
  /** Month-end stamp the universe mask was applied — universe mask is monthly,
   *  this surfaces "why did membership change?" disambiguation for callers. */
  mask_as_of: string;
  members: UniverseMember[];
  counts: UniverseMembersCounts;
}

/**
 * Active members of a named universe at a given teo (latest by default).
 * Active = universe_mask AND validity. Universe mask is monthly (stamped at
 * month-end and applied to every teo in the following month); validity is
 * daily. Symbols failing either gate are NOT in the response.
 *
 * @param universe One of the KNOWN_UNIVERSES labels (uni_mc_50/500/1000/3000,
 *                 uni_dv_50/500/1000/3000). Caller is responsible for label
 *                 validation against the registry.
 * @param teo Optional YYYY-MM-DD. Defaults to the latest teo in ds_masks.
 */
export async function readUniverseMembers(
  universe: string,
  teo?: string,
): Promise<UniverseMembersResult | null> {
  const grp = await openZarrGroup(zarrMasksBasename());
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return null;

  const symMap = await readSymbolIndexMap(grp);
  if (!symMap?.size) return null;
  const symByIndex: string[] = new Array(symMap.size);
  for (const [sym, idx] of symMap) symByIndex[idx] = sym;
  const nSymbol = symByIndex.length;

  const tickerByIndex = (await readTickerByIndex(grp)) ?? symByIndex;

  const teoIdx = resolveTeoIndex(teos, teo);
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return null;

  const [maskRow, validityRow] = await Promise.all([
    readBoolRowAtTeo(grp, universe, teoIdx, nSymbol),
    readBoolRowAtTeo(grp, "validity", teoIdx, nSymbol),
  ]);

  if (!maskRow) return null;
  // validityRow may be absent on legacy stores; degrade gracefully to mask-only
  // (still report the missing gate via counts).
  const validity = validityRow ?? new Array<boolean>(nSymbol).fill(true);

  let active = 0;
  let inUniverseMask = 0;
  let inactiveFromValidity = 0;
  const members: UniverseMember[] = [];
  for (let i = 0; i < nSymbol; i++) {
    const inUni = maskRow[i] ?? false;
    if (!inUni) continue;
    inUniverseMask++;
    if (!validity[i]) {
      inactiveFromValidity++;
      continue;
    }
    active++;
    const sym = symByIndex[i];
    if (!sym) continue;
    members.push({
      symbol: sym,
      ticker: tickerByIndex[i] ?? sym,
    });
  }

  members.sort((a, b) => a.ticker.localeCompare(b.ticker));

  // The universe mask is stamped at month-end and applied to every teo in the
  // following month. Surface the most recent month-end <= the requested teo so
  // callers can disambiguate "membership changed because new month" from
  // "membership changed because daily validity failed."
  const teoDate = new Date(`${teoStr}T00:00:00Z`);
  const monthEnd = new Date(
    Date.UTC(teoDate.getUTCFullYear(), teoDate.getUTCMonth() + 1, 0),
  );
  // If the queried teo is mid-month, the mask was stamped at the PRIOR month-end.
  const maskAsOf =
    teoDate.getTime() >= monthEnd.getTime()
      ? monthEnd.toISOString().slice(0, 10)
      : new Date(
          Date.UTC(teoDate.getUTCFullYear(), teoDate.getUTCMonth(), 0),
        )
          .toISOString()
          .slice(0, 10);

  return {
    universe,
    teo: teoStr,
    mask_as_of: maskAsOf,
    members,
    counts: {
      active,
      in_universe_mask: inUniverseMask,
      inactive_from_validity: inactiveFromValidity,
    },
  };
}

// ============================================================================
// ETF factor returns (R.7 — GET /api/etf/factor-returns)
// ============================================================================

/** Trailing return windows surfaced by the factor-returns snapshot. */
export const ETF_FACTOR_RETURN_WINDOWS = [1, 21, 63, 252] as const;
export type EtfFactorReturnWindow = (typeof ETF_FACTOR_RETURN_WINDOWS)[number];

export interface EtfFactorReturnRow {
  ticker: string;
  /** Close price at the snapshot teo (split-adjusted, native ETF currency). */
  close: number | null;
  /** Trailing total returns over each window, computed as close[t]/close[t-N]-1.
   *  Null if the window extends past the start of the ETF's history. */
  returns: Record<`${EtfFactorReturnWindow}d`, number | null>;
}

export interface EtfFactorReturnsSnapshot {
  teo: string;
  rows: EtfFactorReturnRow[];
}

/**
 * One-teo snapshot of close + trailing-window returns for a list of ETF
 * tickers from ds_etf.zarr. Tickers not in the store are silently skipped
 * (the caller's classification registry is authoritative for what's a "factor
 * ETF" but the zarr is authoritative for what actually has data).
 */
export async function readEtfFactorReturnsSnapshot(params: {
  tickers: string[];
  teo?: string;
}): Promise<EtfFactorReturnsSnapshot | null> {
  if (!params.tickers.length) return null;

  const grp = await openZarrGroup(zarrEtfBasename());
  if (!grp) return null;

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return null;

  const symMap = await readSymbolIndexMap(grp);
  if (!symMap?.size) return null;

  // ds_etf's symbol axis uses internal bw_sym_ids; the human-readable ticker
  // lives in the `ticker` coord. Build ticker → symbol-index lookup so the
  // caller's request maps cleanly without leaking bw_sym_ids out of the DAL.
  const tickerByIndex = await readTickerByIndex(grp);
  const tickerToIdx = new Map<string, number>();
  if (tickerByIndex) {
    for (let i = 0; i < tickerByIndex.length; i++) {
      const t = tickerByIndex[i];
      if (t) tickerToIdx.set(t, i);
    }
  } else {
    // Fall back to symbol axis if ticker coord is absent (shouldn't happen on
    // production ds_etf but keeps the reader robust against legacy stores).
    for (const [sym, idx] of symMap) tickerToIdx.set(sym, idx);
  }

  const teoIdx = resolveTeoIndex(teos, params.teo);
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return null;

  // One window read per ETF covering the longest trailing window — close[t-252:t+1].
  const maxWindow = Math.max(...ETF_FACTOR_RETURN_WINDOWS);
  const t0 = Math.max(0, teoIdx - maxWindow);
  const t1 = teoIdx + 1;

  const rows: EtfFactorReturnRow[] = [];
  for (const ticker of params.tickers) {
    const symIdx = tickerToIdx.get(ticker);
    if (symIdx === undefined) continue;

    const closes = await readFloatSeriesTeoSymbol(grp, "close", t0, t1, symIdx);
    if (!closes?.length) {
      rows.push({
        ticker,
        close: null,
        returns: { "1d": null, "21d": null, "63d": null, "252d": null },
      });
      continue;
    }

    const offsetT = teoIdx - t0;
    const closeT = closes[offsetT] ?? null;

    const ret = {} as Record<`${EtfFactorReturnWindow}d`, number | null>;
    for (const w of ETF_FACTOR_RETURN_WINDOWS) {
      const pastOffset = offsetT - w;
      if (pastOffset < 0) {
        ret[`${w}d`] = null;
        continue;
      }
      const past = closes[pastOffset];
      if (closeT == null || past == null || past === 0) {
        ret[`${w}d`] = null;
        continue;
      }
      ret[`${w}d`] = closeT / past - 1;
    }

    rows.push({ ticker, close: closeT, returns: ret });
  }

  return { teo: teoStr, rows };
}
