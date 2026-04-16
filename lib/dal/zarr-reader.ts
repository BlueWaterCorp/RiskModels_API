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
  zarrRankingsBasename,
  zarrReturnsBasename,
} from "@/lib/zarr-config";
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
  const needReturns = keys.some((k) => getZarrSpec(k)?.role === "returns");

  const hedgeGrp = needHedge ? await openZarrGroup(zarrHedgeBasename()) : null;
  const hedgeTeo = hedgeGrp ? await readTeoStrings(hedgeGrp) : null;
  const hedgeSymMap = hedgeGrp ? await readSymbolIndexMap(hedgeGrp) : null;

  const returnsGrp = needReturns ? await openZarrGroup(zarrReturnsBasename()) : null;
  const returnsTeo = returnsGrp ? await readTeoStrings(returnsGrp) : null;
  const returnsSymMap = returnsGrp ? await readSymbolIndexMap(returnsGrp) : null;
  const levelMaps = returnsGrp ? await readLevelIndexMap(returnsGrp) : null;

  // ETF store. Disjoint from ds_daily — ~100 ETFs with their own CUSIP-based
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

  const rows: SecurityHistoryRow[] = [];

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
      const spec = getZarrSpec(key);
      if (!spec) continue;

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
            continue;
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
  const rankVar = `rank_ord_${prefix}`;
  const cohortVar = `cohort_size_${prefix}`;

  const grp = await openZarrGroup(zarrRankingsBasename());
  if (!grp) return { teo: null, rows: [] };

  const teos = await readTeoStrings(grp);
  if (!teos?.length) return { teo: null, rows: [] };

  // Resolve symbols via the same coord helper as the daily store. Rankings
  // uses the universe symbol roster (e.g. uni_mc_3000), which may differ
  // from ds_daily's roster — never share indices across stores.
  const symMap = await readSymbolIndexMap(grp);
  if (!symMap?.size) return { teo: null, rows: [] };
  const symByIndex: string[] = new Array(symMap.size);
  for (const [sym, idx] of symMap) symByIndex[idx] = sym;
  const nSymbol = symByIndex.length;

  // Latest teo = last entry in the sorted teo coord. Rankings are written
  // dense per teo, so we trust the last index rather than scanning for the
  // last non-null row (which would defeat the chunking optimization).
  const teoIdx = teos.length - 1;
  const teoStr = teos[teoIdx] ?? null;
  if (!teoStr) return { teo: null, rows: [] };

  const rankRow = await readFloatRowAtTeo(grp, rankVar, teoIdx, nSymbol);
  if (!rankRow) {
    // Variable doesn't exist in this store (e.g. PIT-only metrics under a
    // non-1d window: rank_ord_252d_universe_mkt_cap is never written).
    // Return empty rather than erroring — matches the prior Supabase
    // behavior where the EAV row simply wasn't present.
    return { teo: teoStr, rows: [] };
  }

  // Build (symbol, rank_ordinal) pairs, drop nulls and invalid (<1) ranks.
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

  // Top-K by ascending rank (1 = best). Partial sort would be faster but
  // candidates is already small (low thousands) — full sort is fine.
  candidates.sort((a, b) => a.rank - b.rank);
  const top = candidates.slice(0, cap);

  // Cohort sizes: read the row once, index by symbol position. Same chunk
  // shape as rank, so this is a second ~12KB read. Skip if the variable is
  // missing (cohort_size_* should always exist alongside rank_ord_*, but
  // be defensive).
  const cohortRow = await readFloatRowAtTeo(grp, cohortVar, teoIdx, nSymbol);
  const rows: RankingSnapshotRow[] = top.map((c) => {
    const cs = cohortRow?.[c.idx];
    return {
      symbol: c.symbol,
      rank_ordinal: c.rank,
      cohort_size: cs != null && Number.isFinite(cs) ? Math.round(cs) : null,
    };
  });

  return { teo: teoStr, rows };
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
