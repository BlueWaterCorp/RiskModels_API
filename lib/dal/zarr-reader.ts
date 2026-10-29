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
import type { Array as ZarrArray, DataType, Group } from "zarrita";
import {
  getZarrFactorSetId,
  zarrDailyBasename,
  zarrEtfBasename,
  zarrExposureMonthEndBasename,
  zarrHedgeBasename,
  zarrLinkBetasBasename,
  zarrWeeklyHedgeBasename,
  zarrMasksBasename,
  zarrRankingsBasename,
  zarrResidualSignalBasename,
  zarrReturnsBasename,
  zarrIndustryBasename,
} from "@/lib/zarr-config";
import { getCache, setCache, CACHE_TTL, generateCacheKey } from "@/lib/cache/redis";
import { resolveZarrGcsPrefix, zarrPrefixCacheKey, type ZarrGcsPrefix } from "./zarr-release-slots";
import { indexFromCoords, type DailyTickerHolderIndex } from "./daily-ticker-index";
import type { SecurityHistoryRow, V3MetricKey, V3Periodicity } from "./risk-engine-v3";
import { getZarrSpec, ZARR_UNSUPPORTED_DAILY_KEYS } from "./zarr-metric-registry";
import { SERVED_HISTORY_START, clampStart, servedHistoryStartForKeys } from "./served-history";
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
  /**
   * `cacheScope` prefixes the chunk-cache keys: the release key of the resolved
   * prefix, so a slot re-used by a later publish never serves the previous
   * release's bytes from this cache ("" = the fixed prefix, keys as before).
   */
  constructor(
    private readonly bucket: Bucket,
    private readonly zarrObjectPrefix: string,
    private readonly cacheScope: string = "",
  ) {}

  private cacheKey(objectName: string): string {
    return this.cacheScope ? `${this.cacheScope}|${objectName}` : objectName;
  }

  async get(key: AbsolutePath): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    const chunkKey = this.cacheKey(objectName);
    const cached = zarrChunkCacheGet(chunkKey);
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
    zarrChunkCacheSet(chunkKey, promise);
    // Don't let a transient failure poison the cache for the full TTL.
    promise.catch(() => zarrChunkCache.delete(chunkKey));
    return promise;
  }

  /** Bytes [start, end) of one object (fewer at its end); undefined if it does not exist. */
  async getByteRange(key: AbsolutePath, start: number, end: number): Promise<Uint8Array | undefined> {
    const rel = key.startsWith("/") ? key.slice(1) : key;
    const objectName = `${this.zarrObjectPrefix}/${rel}`.replace(/\/+/g, "/");
    const cacheKey = `${this.cacheKey(objectName)}#${start}-${end}`;
    const cached = zarrChunkCacheGet(cacheKey);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const [buf] = await this.bucket
          .file(objectName)
          .download({ start, end: end - 1, validation: false });
        return new Uint8Array(buf);
      } catch (e: unknown) {
        const err = e as { code?: number };
        if (err?.code === 404 || err?.code === 416) return undefined;
        console.error("[zarr-internal] storage range read failed");
        throw new Error("Zarr read failed");
      }
    })();
    zarrChunkCacheSet(cacheKey, promise);
    promise.catch(() => zarrChunkCache.delete(cacheKey));
    return promise;
  }
}

/** Group → its raw GCS store, for byte-range reads that bypass zarrita. */
const rawStoreByGroup = new WeakMap<object, GcsZarrStore>();

async function openZarrGroupUncached(
  objectPrefix: string,
  prefix: ZarrGcsPrefix,
): Promise<Group<Readable> | null> {
  const { bucket: bucketName, basePath } = prefix;
  const fullPrefix = `${basePath}/${objectPrefix}`.replace(/\/+/g, "/").replace(/^\//, "");
  try {
    const bucket = getGcs().bucket(bucketName);
    const raw = new GcsZarrStore(bucket, fullPrefix, prefix.release ? zarrPrefixCacheKey(prefix) : "");
    const consolidated = await tryWithConsolidated(raw);
    const store = consolidated as unknown as Readable;
    const grp = (await open.v2(root(store), { kind: "group" })) as Group<Readable>;
    rawStoreByGroup.set(grp, raw);
    return grp;
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
 *
 * Keyed on the resolved prefix (`zarrPrefixCacheKey`: with release slots on,
 * the slot and release id CURRENT names) plus the store, so after a flip the
 * next open goes to the new slot instead of reusing an old-slot group for up
 * to 30 minutes. A reader that opens several stores for one response passes
 * one resolved `prefix` to every open so the response never straddles a flip.
 */
const GROUP_CACHE_TTL_MS = 30 * 60 * 1000;
// Bounded: with release slots, every flip adds one key per store (the old ones age out).
const GROUP_CACHE_MAX = 256;
const zarrGroupCache = new Map<
  string,
  { at: number; promise: Promise<Group<Readable> | null> }
>();

async function openZarrGroup(
  objectPrefix: string,
  prefix?: ZarrGcsPrefix,
): Promise<Group<Readable> | null> {
  const p = prefix ?? (await resolveZarrGcsPrefix());
  const key = `${zarrPrefixCacheKey(p)}|${objectPrefix}`;
  const hit = zarrGroupCache.get(key);
  if (hit && Date.now() - hit.at < GROUP_CACHE_TTL_MS) return hit.promise;
  const promise = openZarrGroupUncached(objectPrefix, p);
  zarrGroupCache.set(key, { at: Date.now(), promise });
  if (zarrGroupCache.size > GROUP_CACHE_MAX) {
    const oldest = zarrGroupCache.keys().next().value;
    if (oldest !== undefined) zarrGroupCache.delete(oldest);
  }
  return promise;
}

/** Test hook: the keys of the in-process group cache. */
export function _zarrGroupCacheKeysForTest(): string[] {
  return [...zarrGroupCache.keys()];
}

/** Test hook: open a group through the cache with an injected prefix (no GCS call when cached). */
export async function _openZarrGroupForTest(
  objectPrefix: string,
  prefix?: ZarrGcsPrefix,
): Promise<Group<Readable> | null> {
  return openZarrGroup(objectPrefix, prefix);
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

// ---------------------------------------------------------------------
// Partial chunk reads: only the blosc blocks a short date window needs.
// ---------------------------------------------------------------------
//
// The ERM3 stores are chunked [whole teo axis, 64 symbols] (~1.7 MB raw,
// ~1 MB compressed), and a blosc-1 chunk is a sequence of independently
// compressed blocks (512 KB raw here) with a table of their offsets in the
// header. A read of a few dates (POST /portfolio/exposure with as_of) needs
// one block of four, so it fetches the header and that block by byte range
// and decodes only them. Anything this reader does not recognise returns
// null and the caller decodes the whole chunk through zarrita as before.

/** Raw LZ4 block decode of src[sStart, sEnd) into exactly dst[dStart, dStart + dLen). */
function lz4DecodeInto(
  src: Uint8Array,
  sStart: number,
  sEnd: number,
  dst: Uint8Array,
  dStart: number,
  dLen: number,
): boolean {
  let ip = sStart;
  let op = dStart;
  const oEnd = dStart + dLen;
  while (ip < sEnd) {
    const token = src[ip++]!;
    let lit = token >>> 4;
    if (lit === 15) {
      let b: number;
      do {
        if (ip >= sEnd) return false;
        b = src[ip++]!;
        lit += b;
      } while (b === 255);
    }
    if (ip + lit > sEnd || op + lit > oEnd) return false;
    dst.set(src.subarray(ip, ip + lit), op);
    ip += lit;
    op += lit;
    if (ip === sEnd) break; // the last sequence carries literals only
    if (ip + 2 > sEnd) return false;
    const off = src[ip]! | (src[ip + 1]! << 8);
    ip += 2;
    if (off === 0 || op - off < dStart) return false;
    let ml = token & 15;
    if (ml === 15) {
      let b: number;
      do {
        if (ip >= sEnd) return false;
        b = src[ip++]!;
        ml += b;
      } while (b === 255);
    }
    ml += 4;
    if (op + ml > oEnd) return false;
    const mp = op - off;
    if (off >= ml) dst.copyWithin(op, mp, mp + ml);
    else for (let k = 0; k < ml; k++) dst[op + k] = dst[mp + k]!;
    op += ml;
  }
  return op === oEnd;
}

/** One blosc-1 block (lz4, optional byte shuffle) from comp[cs, ce); null if it does not parse exactly. */
function decodeBloscBlock(
  comp: Uint8Array,
  cs: number,
  ce: number,
  bsize: number,
  typesize: number,
  flags: number,
  leftover: boolean,
): Uint8Array | null {
  const dv = new DataView(comp.buffer, comp.byteOffset, comp.byteLength);
  const preferred = !(flags & 0x10) && !leftover ? typesize : 1;
  for (const nsplits of preferred === 1 ? [1] : [preferred, 1]) {
    if (bsize % nsplits !== 0) continue;
    const neblock = bsize / nsplits;
    const tmp = new Uint8Array(bsize);
    let pos = cs;
    let ok = true;
    for (let k = 0; k < nsplits && ok; k++) {
      if (pos + 4 > ce) {
        ok = false;
        break;
      }
      const csize = dv.getInt32(pos, true);
      pos += 4;
      if (csize <= 0 || pos + csize > ce) {
        ok = false;
      } else if (csize === neblock) {
        tmp.set(comp.subarray(pos, pos + csize), k * neblock);
      } else {
        ok = lz4DecodeInto(comp, pos, pos + csize, tmp, k * neblock, neblock);
      }
      pos += csize;
    }
    if (!ok || pos !== ce) continue;
    if (!(flags & 0x1) || typesize <= 1) return tmp;
    // Byte unshuffle: element i's byte j sits at j * n + i.
    const out = new Uint8Array(bsize);
    const n = Math.floor(bsize / typesize);
    for (let j = 0; j < typesize; j++) {
      const base = j * n;
      for (let i = 0; i < n; i++) out[i * typesize + j] = tmp[base + i]!;
    }
    out.set(tmp.subarray(n * typesize), n * typesize);
    return out;
  }
  return null;
}

/**
 * Uncompressed bytes [byteStart, byteEnd) of one blosc-1 chunk object,
 * fetching only the header and the blocks that cover them. undefined: the
 * object does not exist (fill value). null: not a layout handled here, or the
 * range spans every block anyway — decode the whole chunk instead.
 */
async function readBloscByteRange(
  raw: GcsZarrStore,
  key: AbsolutePath,
  byteStart: number,
  byteEnd: number,
): Promise<Uint8Array | null | undefined> {
  let head = await raw.getByteRange(key, 0, 256);
  if (head === undefined) return undefined;
  if (head.length < 16) return null;
  let dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = head[0]!;
  const flags = head[2]!;
  const typesize = head[3]!;
  const nbytes = dv.getInt32(4, true);
  const blocksize = dv.getInt32(8, true);
  const cbytes = dv.getInt32(12, true);
  // blosc-1 format 2, lz4 (compformat 1), not memcpyed, no bit-shuffle.
  if (version !== 2 || flags & 0x2 || flags & 0x4 || flags >> 5 !== 1) return null;
  if (typesize < 1 || blocksize <= 0 || nbytes <= 0 || byteEnd > nbytes || byteStart >= byteEnd) {
    return null;
  }
  const nblocks = Math.ceil(nbytes / blocksize);
  const b0 = Math.floor(byteStart / blocksize);
  const b1 = Math.floor((byteEnd - 1) / blocksize);
  if (b1 - b0 + 1 >= nblocks) return null;
  const hdrLen = 16 + 4 * nblocks;
  if (hdrLen > head.length) {
    const h = await raw.getByteRange(key, 0, hdrLen);
    if (!h || h.length < hdrLen) return null;
    head = h;
    dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  }
  // Blocks are written in completion order when blosc compresses with several
  // threads, so offsets are not monotonic: a block ends where the next-higher
  // offset (or the chunk) begins.
  const starts: number[] = [];
  for (let b = 0; b < nblocks; b++) starts.push(dv.getInt32(16 + 4 * b, true));
  const sorted = [...starts].sort((a, b) => a - b);
  if (sorted[0]! < hdrLen || sorted[nblocks - 1]! >= cbytes) return null;
  for (let k = 1; k < nblocks; k++) if (sorted[k]! <= sorted[k - 1]!) return null;
  const blockEnd = (start: number) => {
    const k = sorted.indexOf(start);
    return k + 1 < nblocks ? sorted[k + 1]! : cbytes;
  };

  const out = new Uint8Array((b1 - b0 + 1) * blocksize);
  for (let b = b0; b <= b1; b++) {
    const from = starts[b]!;
    const to = blockEnd(from);
    const comp = await raw.getByteRange(key, from, to);
    if (!comp || comp.length !== to - from) return null;
    const leftover = b === nblocks - 1 && nbytes % blocksize !== 0;
    const bsize = leftover ? nbytes % blocksize : blocksize;
    const block = decodeBloscBlock(comp, 0, comp.length, bsize, typesize, flags, leftover);
    if (!block) return null;
    out.set(block, (b - b0) * blocksize);
  }
  return out.subarray(byteStart - b0 * blocksize, byteEnd - b0 * blocksize);
}

interface ZArrayMeta {
  chunks: number[];
  dtype: string;
  order: string;
  compressor: { id?: string } | null;
  filters: unknown[] | null;
  dimension_separator?: string;
}

const zarrayMetaCache = new WeakMap<object, Map<string, Promise<ZArrayMeta | null>>>();

/** `.zarray` of one variable, from the group's consolidated metadata. */
function readZArrayMeta(grp: Group<Readable>, varName: string): Promise<ZArrayMeta | null> {
  let byVar = zarrayMetaCache.get(grp);
  if (!byVar) {
    byVar = new Map();
    zarrayMetaCache.set(grp, byVar);
  }
  let p = byVar.get(varName);
  if (!p) {
    p = (async () => {
      try {
        const bytes = await grp.store.get(`${grp.resolve(varName).path}/.zarray` as AbsolutePath);
        return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as ZArrayMeta) : null;
      } catch {
        return null;
      }
    })();
    byVar.set(varName, p);
  }
  return p;
}

/**
 * Partial-read path of readColumnBlock: little-endian float32, C order,
 * blosc compressor and no filters; the rows inside one teo chunk. Returns
 * null whenever the full-chunk path should be used instead.
 */
async function readColumnBlockPartial(
  grp: Group<Readable>,
  varName: string,
  sel: { t0: number; t1: number; levelIdx?: number },
  symIdxs: number[],
): Promise<(number | null)[][] | null> {
  // Ops kill switch: ZARR_PARTIAL_READS=0 always decodes whole chunks.
  if (process.env.ZARR_PARTIAL_READS === "0") return null;
  const raw = rawStoreByGroup.get(grp);
  if (!raw || sel.t1 <= sel.t0) return null;
  const meta = await readZArrayMeta(grp, varName);
  if (
    !meta ||
    meta.dtype !== "<f4" ||
    meta.order !== "C" ||
    meta.compressor?.id !== "blosc" ||
    (meta.filters != null && meta.filters.length > 0)
  ) {
    return null;
  }
  const nd = sel.levelIdx === undefined ? 2 : 3;
  if (meta.chunks.length !== nd) return null;
  const [CT, CW] = meta.chunks as [number, number];
  const CL = nd === 3 ? meta.chunks[2]! : 1;
  const l = sel.levelIdx ?? 0;
  if (nd === 3 && l >= CL) return null; // level axis split across chunks
  const tc = Math.floor(sel.t0 / CT);
  if (Math.floor((sel.t1 - 1) / CT) !== tc) return null;
  const c0 = Math.min(...symIdxs);
  const c1 = Math.max(...symIdxs) + 1;
  const sc = Math.floor(c0 / CW);
  if (Math.floor((c1 - 1) / CW) !== sc) return null;

  // Element offset inside the (full-size, C-order) chunk.
  const at = (t: number, s: number) => ((t - tc * CT) * CW + (s - sc * CW)) * CL + l;
  const e0 = at(sel.t0, c0);
  const e1 = at(sel.t1 - 1, c1 - 1) + 1;
  const sep = meta.dimension_separator ?? ".";
  const coords = nd === 3 ? [tc, sc, 0] : [tc, sc];
  const key = `${grp.resolve(varName).path}/${coords.join(sep)}` as AbsolutePath;
  const bytes = await readBloscByteRange(raw, key, e0 * 4, e1 * 4);
  if (!bytes) return null;
  const f32 = new Float32Array(bytes.slice().buffer);
  const T = sel.t1 - sel.t0;
  return symIdxs.map((j) => {
    const out = new Array<number | null>(T);
    for (let i = 0; i < T; i++) {
      const x = f32[at(sel.t0 + i, j) - e0]!;
      out[i] = Number.isFinite(x) ? x : null;
    }
    return out;
  });
}

/**
 * Columns `symIdxs` (all inside one symbol chunk) of a (teo, symbol) or
 * (teo, symbol, level) array over rows [t0, t1), in one get: one chunk
 * decode however many names it serves. Values convert exactly as the
 * per-(symbol, key) readers this replaced did: float mode reads Float32/Float64
 * only (NaN → null); numeric mode also passes integer arrays through.
 */
async function readColumnBlock(
  grp: Group<Readable>,
  varName: string,
  arr: ZarrArray<DataType, Readable>,
  sel: { t0: number; t1: number; levelIdx?: number; mode: "float" | "numeric" },
  symIdxs: number[],
): Promise<(number | null)[][] | null> {
  try {
    const partial = await readColumnBlockPartial(grp, varName, sel, symIdxs).catch(() => null);
    if (partial) return partial;
    const c0 = Math.min(...symIdxs);
    const c1 = Math.max(...symIdxs) + 1;
    const ch = await get(
      arr,
      sel.levelIdx === undefined
        ? [slice(sel.t0, sel.t1), slice(c0, c1)]
        : [slice(sel.t0, sel.t1), slice(c0, c1), sel.levelIdx],
    );
    const d = ch?.data;
    const isFloat = d instanceof Float32Array || d instanceof Float64Array;
    const isInt =
      d instanceof Uint8Array ||
      d instanceof Int8Array ||
      d instanceof Uint16Array ||
      d instanceof Int16Array ||
      d instanceof Int32Array ||
      d instanceof Uint32Array;
    if (!isFloat && !(sel.mode === "numeric" && isInt)) return null;
    const vals = d as ArrayLike<number>;
    const [s0, s1] = ch.stride as number[];
    const T = sel.t1 - sel.t0;
    return symIdxs.map((j) => {
      const out = new Array<number | null>(T);
      const off = (j - c0) * s1!;
      for (let i = 0; i < T; i++) {
        const x = vals[i * s0! + off]!;
        out[i] = isFloat ? (Number.isFinite(x) ? x : null) : x;
      }
      return out;
    });
  } catch {
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

function cacheKeyForZarr(p: ReadHistorySliceParams, prefix: ZarrGcsPrefix): string {
  const factorSet = getZarrFactorSetId();
  const payload = JSON.stringify({
    // the release CURRENT named (release slots on): a flip is a new key; absent = unchanged key
    ...(prefix.release ? { rel: zarrPrefixCacheKey(prefix) } : {}),
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

/** Windows up to this many trading days use the wider short-window read pool. */
const SHORT_WINDOW_ROWS = 64;

/** History slices above this many rows (~5 MB serialized) are not cached. */
export const MAX_CACHED_SLICE_ROWS = 50_000;

/** Upper-bound row estimate for a slice request: symbols × keys × trading days. */
export function estimateSliceRows(params: ReadHistorySliceParams): number {
  const end = params.endDate ? Date.parse(`${params.endDate}T00:00:00Z`) : Date.now();
  const start = params.startDate ? Date.parse(`${params.startDate}T00:00:00Z`) : Date.parse("2000-01-01T00:00:00Z");
  const calendarDays = Number.isFinite(end - start) ? Math.max(1, (end - start) / 86_400_000 + 1) : 7_300;
  const tradingDays = Math.ceil((calendarDays * 252) / 365);
  return params.symbols.length * params.keys.length * tradingDays;
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

  // One prefix for the whole slice: every store below is opened from the same release.
  const prefix = await resolveZarrGcsPrefix();
  const ck = cacheKeyForZarr(params, prefix);
  // A request this large was never cached (see the write below); skip the lookup.
  const hit = estimateSliceRows(params) > MAX_CACHED_SLICE_ROWS ? null : await getCache<ReadHistorySliceResult>(ck);
  // `[]` is truthy in JS — only treat cache as a hit when we stored real rows.
  if (hit?.rows?.length) {
    logSliceTelemetry(params, "cache_hit", hit.rows.length, Date.now() - _tStart);
    return hit;
  }

  // Daily store is always opened. Hedge/returns are opened lazily only if
  // the requested key set actually touches them — avoids a pointless GCS
  // round-trip on vanilla returns/price queries.
  const dailyGrp = await openZarrGroup(zarrDailyBasename(), prefix);
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

  const hedgeGrp = needHedge ? await openZarrGroup(zarrHedgeBasename(), prefix) : null;
  const hedgeTeo = hedgeGrp ? await readTeoStrings(hedgeGrp) : null;
  const hedgeSymMap = hedgeGrp ? await readSymbolIndexMap(hedgeGrp) : null;

  const returnsGrp = needReturns ? await openZarrGroup(zarrReturnsBasename(), prefix) : null;
  const returnsTeo = returnsGrp ? await readTeoStrings(returnsGrp) : null;
  const returnsSymMap = returnsGrp ? await readSymbolIndexMap(returnsGrp) : null;
  const levelMaps = returnsGrp ? await readLevelIndexMap(returnsGrp) : null;

  // ETF store. Disjoint from ds_daily — the priced ETF universe (128 funds on
  // the 2026-10-14 build; the count moves with the ERM3 register, so read
  // `readEtfStoreIndex()` or GET /api/data/etf/universe rather than trusting
  // a number here). Its symbol axis carries its own bw_sym_ids (mostly
  // FIGI-based, e.g. SPY = BW-BBG000BDTBL9). Always opened because the
  // caller's symbol list can contain a mix of stocks and ETFs and we can't
  // tell which is which upfront without a Supabase round-trip. The store is
  // small (~130 symbols) so the cost of an unneeded open is negligible.
  // ETFs don't decompose into factor exposures, so hedge/returns roles are
  // skipped for ETF symbols — the existing per-store symMap guards enforce
  // that automatically.
  const etfGrp = await openZarrGroup(zarrEtfBasename(), prefix);
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
  let effStart = clampStart(startDate, servedHistoryStartForKeys(keys)) ?? "";
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

  // Reads are grouped by (store variable, symbol chunk). Every store here is
  // chunked [whole teo axis, 64 symbols], and zarrita decodes the whole chunk
  // (~1.7 MB) on every get, however few cells are selected. One get per
  // (symbol, key) decoded each chunk once per name in it: ~13k decodes for a
  // 925-name, 14-key book (~160 s, a 504 on POST /portfolio/exposure with
  // as_of). One get per (variable, chunk) decodes each chunk once. The
  // routing below (which store, which variable, how a value maps) is the same
  // as the old per-pair reader; only the read is shared.
  interface ReadTarget {
    grp: Group<Readable>;
    varName: string;
    levelIdx?: number;
    t0: number;
    t1: number;
    teo: string[];
    /** float: Float32/64 only, NaN → null. numeric: also integer arrays. */
    mode: "float" | "numeric";
    toValue: (v: number | null) => number | null;
  }
  const same = (v: number | null) => v;

  const route = (
    key: V3MetricKey,
    idxs: {
      dailyIdx: number | undefined;
      etfIdx: number | undefined;
      hedgeIdx: number | undefined;
      returnsIdx: number | undefined;
    },
  ): { store: string; idx: number; target: ReadTarget } | null => {
    const { dailyIdx, etfIdx, hedgeIdx, returnsIdx } = idxs;
    const spec = getZarrSpec(key);
    if (!spec) return null;

    if (spec.role === "daily") {
      // Stock path first.
      if (dailyIdx !== undefined) {
        if (dt1 <= dt0) return null;
        return {
          store: "daily",
          idx: dailyIdx,
          target: { grp: dailyGrp, varName: spec.zarrVar, t0: dt0, t1: dt1, teo: dailyTeo, mode: "float", toValue: same },
        };
      }
      // ETF path: only if the symbol isn't in ds_daily at all.
      if (etfGrp && etfIdx !== undefined && etfTeo?.length && etfT1 > etfT0) {
        return {
          store: "etf",
          idx: etfIdx,
          target: { grp: etfGrp, varName: spec.zarrVar, t0: etfT0, t1: etfT1, teo: etfTeo, mode: "float", toValue: same },
        };
      }
      return null;
    }

    if (spec.role === "hedge") {
      if (!hedgeGrp || hedgeIdx === undefined || !hedgeTeo || ht1 <= ht0) return null;
      const isVolDerived = "derivedVol23d" in spec && spec.derivedVol23d;
      const isStockVarRaw = "asStockVar" in spec && spec.asStockVar;
      const zarrVar = isVolDerived || isStockVarRaw ? "_stock_var" : spec.zarrVar;
      const toValue = isVolDerived
        ? (sv: number | null) =>
            sv != null && Number.isFinite(sv) && sv >= 0 ? Math.sqrt(sv * 252) : null
        : same;
      return {
        store: "hedge",
        idx: hedgeIdx,
        target: { grp: hedgeGrp, varName: zarrVar, t0: ht0, t1: ht1, teo: hedgeTeo, mode: "float", toValue },
      };
    }

    if (spec.role === "returns") {
      if (!returnsGrp || returnsIdx === undefined || !returnsTeo || !levelMaps || rt1 <= rt0) {
        return null;
      }
      const li = levelMaps.get(spec.level);
      if (li === undefined) return null;
      return {
        store: "returns",
        idx: returnsIdx,
        target: { grp: returnsGrp, varName: spec.zarrVar, levelIdx: li, t0: rt0, t1: rt1, teo: returnsTeo, mode: "float", toValue: same },
      };
    }

    if (spec.role === "returnsFlat") {
      if (!returnsGrp || returnsIdx === undefined || !returnsTeo || rt1 <= rt0) return null;
      const sentinel = spec.nullSentinel;
      return {
        store: "returns",
        idx: returnsIdx,
        target: {
          grp: returnsGrp,
          varName: spec.zarrVar,
          t0: rt0,
          t1: rt1,
          teo: returnsTeo,
          mode: "numeric",
          toValue: (v) => (v != null && sentinel !== undefined && v === sentinel ? null : v),
        },
      };
    }
    return null;
  };

  // (key, store) → the read target and the symbols that read it.
  const groups = new Map<
    string,
    { key: V3MetricKey; target: ReadTarget; members: Array<{ symbol: string; idx: number }> }
  >();
  for (const symbol of symbols) {
    // Each store has its OWN symbol roster and ordering. Resolve per store.
    // ETFs live in ds_etf.zarr and are NOT present in ds_daily — the daily
    // role falls through to the ETF store when `dailyIdx` is undefined but
    // `etfIdx` resolves. Hedge/returns roles intentionally skip ETFs (they
    // don't decompose into factor exposures).
    const idxs = {
      dailyIdx: dailySymMap.get(symbol),
      etfIdx: etfSymMap?.get(symbol),
      hedgeIdx: hedgeSymMap?.get(symbol),
      returnsIdx: returnsSymMap?.get(symbol),
    };
    for (const key of keys) {
      const r = route(key, idxs);
      if (!r) continue;
      const gk = `${key}\u0000${r.store}`;
      const g = groups.get(gk) ?? { key, target: r.target, members: [] };
      g.members.push({ symbol, idx: r.idx });
      groups.set(gk, g);
    }
  }

  const tasks: Array<() => Promise<SecurityHistoryRow[]>> = [];
  await Promise.all(
    [...groups.values()].map(async ({ key, target, members }) => {
      let arr: ZarrArray<DataType, Readable>;
      try {
        arr = await open.v2(target.grp.resolve(target.varName), { kind: "array" });
      } catch {
        return;
      }
      const chunkW = Math.max(1, Number(arr.chunks?.[1]) || 1);
      const byChunk = new Map<number, Array<{ symbol: string; idx: number }>>();
      for (const m of members) {
        const c = Math.floor(m.idx / chunkW);
        const list = byChunk.get(c) ?? [];
        list.push(m);
        byChunk.set(c, list);
      }
      for (const list of byChunk.values()) {
        tasks.push(async () => {
          const cols = await readColumnBlock(
            target.grp,
            target.varName,
            arr,
            target,
            list.map((m) => m.idx),
          );
          const rows: SecurityHistoryRow[] = [];
          if (!cols) return rows;
          list.forEach((m, k) => {
            const vals = cols[k]!;
            for (let i = 0; i < vals.length; i++) {
              const teoStr = target.teo[target.t0 + i];
              if (!teoStr) continue;
              rows.push({
                symbol: m.symbol,
                teo: teoStr,
                periodicity: "daily",
                metric_key: key,
                metric_value: target.toValue(vals[i] ?? null),
              });
            }
          });
          return rows;
        });
      }
    }),
  );

  // Bounded-parallel chunk reads. A small worker pool keeps GCS pressure
  // bounded; the rows.sort below makes output order deterministic regardless
  // of task completion order. A short window (as_of, a single date) reads two
  // small byte ranges per chunk, so its reads are latency-bound and run wider;
  // a long window downloads whole chunks (1–10 MB) and stays narrow.
  // Env-tunable for ops (1 = sequential).
  const windowRows = Math.max(dt1 - dt0, ht1 - ht0, rt1 - rt0, etfT1 - etfT0);
  const ZARR_READ_CONCURRENCY =
    windowRows <= SHORT_WINDOW_ROWS
      ? Math.max(1, Number(process.env.ZARR_SHORT_READ_CONCURRENCY ?? 48) || 48)
      : Math.max(1, Number(process.env.ZARR_READ_CONCURRENCY ?? 8) || 8);
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

  // Ties (same teo and key) keep the caller's symbol order.
  const symbolPos = new Map(symbols.map((s, i) => [s, i] as const));
  rows.sort((a, b) => {
    const c = a.teo.localeCompare(b.teo);
    if (c !== 0) return orderBy === "asc" ? c : -c;
    const k = a.metric_key.localeCompare(b.metric_key);
    if (k !== 0) return k;
    return (symbolPos.get(a.symbol) ?? 0) - (symbolPos.get(b.symbol) ?? 0);
  });

  const result: ReadHistorySliceResult = {
    rows,
    range: [rangeStart, rangeEnd],
  };

  // Large slices (multi-year history for many names) are not cached: they would
  // exceed the cache's value limit, and serializing them just to be refused
  // costs seconds and gigabytes per request.
  if (rows.length > 0 && rows.length <= MAX_CACHED_SLICE_ROWS) {
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

  const effStart = clampStart(startDate, SERVED_HISTORY_START.residual_signal);
  const t0 = effStart ? lowerBound(teos, effStart) : 0;
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
// ds_daily ticker holders — delisted-ticker recall
// =====================================================================

export type { DailyTickerHolderIndex } from "./daily-ticker-index";

const DAILY_HOLDER_TTL_MS = 30 * 60 * 1000;
/** A failed build is retried after a minute, not on every miss. */
const DAILY_HOLDER_NEGATIVE_TTL_MS = 60 * 1000;
let dailyHolderIndexCache: {
  /** Entry expires at this epoch ms. */
  until: number;
  promise: Promise<DailyTickerHolderIndex | null>;
} | null = null;

/** Raw coord cells (strings, or whatever an object-dtype array decodes to). */
async function readRawCoord(grp: Group<Readable>, name: string): Promise<unknown[] | null> {
  try {
    const loc = grp.resolve(name);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data;
    if (d instanceof UnicodeStringArray) {
      return Array.from({ length: d.length }, (_, i) => d.get(i));
    }
    if (Array.isArray(d)) return d as unknown[];
    return null;
  } catch {
    return null;
  }
}

async function buildDailyTickerHolderIndex(): Promise<DailyTickerHolderIndex | null> {
  const grp = await openZarrGroup(zarrDailyBasename());
  if (!grp) return null;
  // Four independent object reads; indexFromCoords fails closed on any gap.
  const [symbols, display, unique, eodhd] = await Promise.all([
    readRawCoord(grp, "symbol"),
    readRawCoord(grp, "ticker"),
    readRawCoord(grp, "unique_ticker"),
    readRawCoord(grp, "eodhd_code"),
  ]);
  return indexFromCoords(symbols, display, unique, eodhd);
}

/**
 * Cached ds_daily ticker-holder index (null when the store or a coord is
 * unavailable). Built once per instance per 30 min; a null build is cached
 * for 60 s so a persistently broken coord does not cost every miss a rebuild.
 */
export async function readDailyTickerHolderIndex(): Promise<DailyTickerHolderIndex | null> {
  const now = Date.now();
  if (dailyHolderIndexCache && now < dailyHolderIndexCache.until) {
    return dailyHolderIndexCache.promise;
  }
  const promise = buildDailyTickerHolderIndex().catch(() => null);
  dailyHolderIndexCache = { until: now + DAILY_HOLDER_TTL_MS, promise };
  promise.then((v) => {
    if (v === null && dailyHolderIndexCache?.promise === promise) {
      dailyHolderIndexCache.until = Date.now() + DAILY_HOLDER_NEGATIVE_TTL_MS;
    }
  });
  return promise;
}

// =====================================================================
// Industry panel — cross-section at (teo × bw_industry_id × level|fact)
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

// Industry dimension name. Current stores use `bw_industry_id` (101-160); stores built before
// the taxonomy switch used the older name, read only until those vintages age out.
const INDUSTRY_DIM_NAMES = ["bw_industry_id", "fs_industry_code"] as const;

async function readIndustryCodeInts(grp: Group<Readable>): Promise<number[] | null> {
  for (const name of INDUSTRY_DIM_NAMES) {
    const got = await readIndustryCodeIntsNamed(grp, name);
    if (got) return got;
  }
  return null;
}

async function readIndustryCodeIntsNamed(grp: Group<Readable>, name: string): Promise<number[] | null> {
  try {
    const loc = grp.resolve(name);
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

// ─────────────────────────────────────────────────────────────────────────────
// ETF coverage inputs (RMAPI-14 — /api/data/etf/universe, /api/data/etf/{ticker})
// ─────────────────────────────────────────────────────────────────────────────

/** One fund on the ds_etf symbol axis — the "priced" capability. */
export interface EtfStoreEntry {
  ticker: string;
  /** Internal symbol id on the ETF store's axis (FIGI-based or opaque BW id). */
  bw_sym_id: string;
  /** First teo with a non-null daily return (what /ticker-returns serves). */
  priced_from: string | null;
  /** Last teo with a non-null daily return. */
  priced_through: string | null;
}

/**
 * Symbol list of the ETF return store with each fund's return-history span.
 * One read of the `return` variable (teo × ~130 symbols); callers cache.
 * Returns null when the store is unreachable — never throws.
 */
export async function readEtfStoreIndex(): Promise<EtfStoreEntry[] | null> {
  const grp = await openZarrGroup(zarrEtfBasename());
  if (!grp) return null;
  const [teos, symbols, tickers] = await Promise.all([
    readTeoStrings(grp),
    readStringCoord(grp, "symbol"),
    readTickerByIndex(grp),
  ]);
  if (!teos?.length || !symbols?.length) return null;

  const nT = teos.length;
  const nS = symbols.length;
  const first: (number | null)[] = new Array(nS).fill(null);
  const last: (number | null)[] = new Array(nS).fill(null);
  try {
    const arr = await open.v2(grp.resolve("return"), { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data as ArrayLike<number> | undefined;
    if (d && d.length === nT * nS) {
      // Row-major (teo, symbol).
      for (let t = 0; t < nT; t++) {
        const base = t * nS;
        for (let i = 0; i < nS; i++) {
          if (Number.isFinite(d[base + i])) {
            if (first[i] === null) first[i] = t;
            last[i] = t;
          }
        }
      }
    }
  } catch {
    // Span unknown — membership on the axis still holds.
  }

  return symbols.map((sym, i) => ({
    ticker: (tickers?.[i] || sym).trim().toUpperCase(),
    bw_sym_id: sym,
    priced_from: first[i] !== null ? teos[first[i]!]! : null,
    priced_through: last[i] !== null ? teos[last[i]!]! : null,
  }));
}

/** ETFs the ERM3 cascade hedges with: the market ETF, sector and subsector ETFs. */
export interface CascadeEtfSets {
  market: string | null;
  sectors: string[];
  subsectors: string[];
}

/**
 * Cascade ETF sets as the model uses them this week: the distinct
 * `sector_etf` / `subsector_etf` coords of the weekly hedge snapshot plus its
 * `market_etf` attr. Two small string-coord reads. Null when the store is
 * unreachable — callers fall back to the public market + sector list.
 */
export async function readCascadeEtfSets(): Promise<CascadeEtfSets | null> {
  const grp = await openZarrGroup(zarrWeeklyHedgeBasename());
  if (!grp) return null;
  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const [sectorEtf, subsectorEtf] = await Promise.all([
    readStringCoord(grp, "sector_etf"),
    readStringCoord(grp, "subsector_etf"),
  ]);
  if (!sectorEtf?.length && !subsectorEtf?.length) return null;
  const market = (attrString(attrs, "market_etf") ?? "SPY").trim().toUpperCase() || "SPY";
  const norm = (xs: string[] | null) =>
    [...new Set((xs ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const sectors = norm(sectorEtf).filter((t) => t !== market);
  const sectorSet = new Set(sectors);
  const subsectors = norm(subsectorEtf).filter((t) => t !== market && !sectorSet.has(t));
  return { market, sectors: sectors.sort(), subsectors: subsectors.sort() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly pre-market hedge snapshot (bulk cross-section)
// ─────────────────────────────────────────────────────────────────────────────

/** Numeric per-symbol fields in the weekly hedge snapshot. */
const WEEKLY_HEDGE_NUMERIC = [
  "L1_market_HR",
  "L2_market_HR",
  "L2_sector_HR",
  "L3_market_HR",
  "L3_sector_HR",
  "L3_subsector_HR",
  "lstar_market_HR",
  "lstar_sector_HR",
  "lstar_subsector_HR",
  "beta_raw_market",
  "beta_raw_sector",
  "beta_raw_subsector",
  "beta_adj_market",
  "beta_adj_sector",
  "beta_adj_subsector",
] as const;

export interface WeeklyHedgeMetadata {
  /** First session the snapshot is valid for (the Monday). */
  effective_from: string | null;
  /** Last session that fed it (the prior Friday's close). */
  computed_through: string | null;
  refit_grid: string | null;
  universe: string | null;
  market_etf: string | null;
  built_at_utc: string | null;
  /**
   * Hedge ratios and betas are on DIFFERENT bases. Carried in the payload
   * rather than left to the docs: applying a dollar hedge ratio to an
   * orthogonalized factor is silently wrong, not an error.
   */
  hr_basis: string | null;
  beta_basis: string | null;
}

export interface WeeklyHedgeRow {
  symbol: string;
  ticker: string;
  lstar_level: number | null;
  sector_etf: string | null;
  subsector_etf: string | null;
  [field: string]: string | number | null;
}

export interface WeeklyHedgeSnapshot {
  metadata: WeeklyHedgeMetadata;
  rows: WeeklyHedgeRow[];
}

/** Read a whole 1-D numeric array (NaN → null). The store has no teo axis. */
async function readNumericCoord1D(
  grp: Group<Readable>,
  name: string,
): Promise<(number | null)[] | null> {
  try {
    const loc = grp.resolve(name);
    const arr = await open.v2(loc, { kind: "array" });
    const ch = await get(arr, null);
    const d = ch?.data as ArrayLike<number> | undefined;
    if (!d || typeof d.length !== "number") return null;
    return Array.from({ length: d.length }, (_, i) => {
      const x = Number(d[i]);
      return Number.isFinite(x) ? x : null;
    });
  } catch {
    return null;
  }
}

function attrString(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key];
  return v === undefined || v === null ? null : String(v);
}

/**
 * The full weekly pre-market hedge cross-section in one read.
 *
 * Deliberately returns EVERY symbol with no pagination: the store is a single
 * ~7.9k-row snapshot (~400 KB), and the consumer is a quant pulling the whole
 * book once a week before Monday's open. Slicing it would add round-trips to a
 * payload that fits in one response.
 *
 * Returns null when the store is absent — the caller decides the status code.
 * Never surfaces bucket names or object paths (see the note at the top of this
 * file).
 */
export async function readWeeklyHedgeSnapshot(
  factorSetId?: string,
): Promise<WeeklyHedgeSnapshot | null> {
  const grp = await openZarrGroup(zarrWeeklyHedgeBasename(factorSetId));
  if (!grp) return null;

  const attrs = (grp.attrs ?? {}) as Record<string, unknown>;
  const [symbols, tickers, sectorEtf, subsectorEtf, lstarLevel] = await Promise.all([
    readStringCoord(grp, "symbol"),
    readStringCoord(grp, "ticker"),
    readStringCoord(grp, "sector_etf"),
    readStringCoord(grp, "subsector_etf"),
    readNumericCoord1D(grp, "lstar_level"),
  ]);
  if (!symbols?.length) return null;

  const numeric = await Promise.all(
    WEEKLY_HEDGE_NUMERIC.map((f) => readNumericCoord1D(grp, f)),
  );

  const metadata: WeeklyHedgeMetadata = {
    effective_from: attrString(attrs, "effective_from"),
    computed_through: attrString(attrs, "computed_through"),
    refit_grid: attrString(attrs, "refit_grid"),
    universe: attrString(attrs, "universe"),
    market_etf: attrString(attrs, "market_etf"),
    built_at_utc: attrString(attrs, "built_at_utc"),
    hr_basis: attrString(attrs, "hr_basis"),
    beta_basis: attrString(attrs, "beta_basis"),
  };

  const rows: WeeklyHedgeRow[] = [];
  symbols.forEach((sym, i) => {
    // IN-MASK ONLY. The store is written across the full symbol axis, but only
    // names modelled for the week carry hedge ratios — on 2026-09-21 that was
    // 2,816 of 7,896. The other 5,080 rows are empty in every column that
    // matters: no hedge ratios, no betas, no ETF legs, lstar_level 0.
    //
    // They are not worth shipping. The axis is rebuilt every week, so there is
    // nothing stable to join them against, and a frame that is 64% nulls
    // invites "is this broken?" as the consumer's first question.
    //
    // Presence of a hedge ratio is the test: it is exactly what the caller came
    // for. Verified equivalent to lstar_level > 0 and to L1_market_HR being
    // present — all three select the same 2,816 rows.
    const hasAnyHedgeRatio = WEEKLY_HEDGE_NUMERIC.some(
      (f, k) => f.endsWith("_HR") && numeric[k]?.[i] != null,
    );
    if (!hasAnyHedgeRatio) return;

    const row: WeeklyHedgeRow = {
      symbol: sym,
      ticker: tickers?.[i] ?? sym,
      lstar_level: lstarLevel?.[i] ?? null,
      sector_etf: sectorEtf?.[i] || null,
      subsector_etf: subsectorEtf?.[i] || null,
    };
    WEEKLY_HEDGE_NUMERIC.forEach((f, k) => {
      row[f] = numeric[k]?.[i] ?? null;
    });
    // Repeated on EVERY row on purpose. Response headers do not survive
    // `pd.read_parquet(saved_file)`, and "which week is this?" is the one
    // question a consumer must be able to answer from the file alone —
    // especially in a week when all history was restated.
    row.effective_from = metadata.effective_from;
    row.computed_through = metadata.computed_through;
    row.refit_grid = metadata.refit_grid;
    row.universe = metadata.universe;
    rows.push(row);
  });

  return { metadata, rows };
}

// ---------------------------------------------------------------------------
// Month-end exposure panel (POST /api/portfolio/exposure/history)
// ---------------------------------------------------------------------------

/** Per-name panel variables, in the order they are read. */
export const EXPOSURE_PANEL_VARS = [
  "l1_mkt_hr",
  "l2_mkt_hr",
  "l2_sec_hr",
  "l3_mkt_hr",
  "l3_sec_hr",
  "l3_sub_hr",
  "l1_res_er",
  "l2_res_er",
  "l3_res_er",
  "l3_mkt_er",
  "l3_sec_er",
  "l3_sub_er",
  "stock_var",
  "lstar_level",
] as const;
export type ExposurePanelVar = (typeof EXPOSURE_PANEL_VARS)[number];

export interface ExposurePanelSlice {
  /** Month-end trading days in range, ascending. */
  teos: string[];
  /** symbol → variable → value per teo (NaN → null). Only requested symbols present in the panel. */
  bySymbol: Map<string, Record<ExposurePanelVar, Array<number | null>>>;
  /** ETF tickers of the covariance axes. */
  etfs: string[];
  /** Per teo, the ETF covariance as a flat row-major Float32Array (etfs × etfs), NaN where unavailable. */
  cov: Float32Array[];
  /** Panel build metadata. */
  attrs: Record<string, unknown>;
}

/**
 * `built_utc` of the month-end panel currently published, or null if the panel
 * or the attribute is unavailable. Reads group attributes only.
 */
export async function readExposureMonthEndBuiltUtc(): Promise<string | null> {
  const grp = await openZarrGroup(zarrExposureMonthEndBasename());
  if (!grp) return null;
  const v = ((grp.attrs ?? {}) as Record<string, unknown>).built_utc;
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Read the month-end panel for `symbols` over [start, end]. Each variable is
 * read for the full symbol axis in the date range (the panel is small: about
 * 240 months × 8k symbols), then subset in memory.
 */
export async function readExposureMonthEndPanel(params: {
  symbols: string[];
  start?: string;
  end?: string;
}): Promise<ExposurePanelSlice | null> {
  const grp = await openZarrGroup(zarrExposureMonthEndBasename());
  if (!grp) return null;
  const allTeos = await readTeoStrings(grp);
  const symIdx = await readSymbolIndexMap(grp);
  const etfs = await readStringCoord(grp, "etf");
  if (!allTeos?.length || !symIdx || !etfs) return null;

  const t0 = params.start ? lowerBound(allTeos, params.start) : 0;
  const t1 = params.end ? upperBoundInclusive(allTeos, params.end) : allTeos.length - 1;
  if (t1 < t0) {
    return { teos: [], bySymbol: new Map(), etfs, cov: [], attrs: (grp.attrs ?? {}) as Record<string, unknown> };
  }
  const teos = allTeos.slice(t0, t1 + 1);
  const nSym = symIdx.size;
  const wanted = params.symbols
    .map((s) => [s, symIdx.get(s)] as const)
    .filter((x): x is readonly [string, number] => x[1] !== undefined);

  const bySymbol = new Map<string, Record<ExposurePanelVar, Array<number | null>>>();
  for (const [s] of wanted) bySymbol.set(s, {} as Record<ExposurePanelVar, Array<number | null>>);

  await Promise.all(
    EXPOSURE_PANEL_VARS.map(async (v) => {
      const arr = await open.v2(grp.resolve(v), { kind: "array" });
      const ch = await get(arr, [slice(t0, t1 + 1), null]);
      const d = ch.data as Float32Array;
      for (const [s, j] of wanted) {
        const col: Array<number | null> = new Array(teos.length);
        for (let t = 0; t < teos.length; t++) {
          const x = d[t * nSym + j]!;
          col[t] = Number.isFinite(x) ? x : null;
        }
        bySymbol.get(s)![v] = col;
      }
    }),
  );

  const covArr = await open.v2(grp.resolve("etf_cov"), { kind: "array" });
  const covCh = await get(covArr, [slice(t0, t1 + 1), null, null]);
  const covData = covCh.data as Float32Array;
  const block = etfs.length * etfs.length;
  const cov = teos.map((_, t) => covData.subarray(t * block, (t + 1) * block));

  return { teos, bySymbol, etfs, cov, attrs: (grp.attrs ?? {}) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Daily exposure history straight from the hedge-weights + returns stores
// ---------------------------------------------------------------------------

/** Panel variable → hedge-weights store variable (lstar_level comes from the returns store). */
const DAILY_HEDGE_VARS: Record<Exclude<ExposurePanelVar, "lstar_level">, string> = {
  l1_mkt_hr: "L1_market_HR",
  l2_mkt_hr: "L2_market_HR",
  l2_sec_hr: "L2_sector_HR",
  l3_mkt_hr: "L3_market_HR",
  l3_sec_hr: "L3_sector_HR",
  l3_sub_hr: "L3_subsector_HR",
  l1_res_er: "L1_residual_ER",
  l2_res_er: "L2_residual_ER",
  l3_res_er: "L3_residual_ER",
  l3_mkt_er: "L3_market_ER",
  l3_sec_er: "L3_sector_ER",
  l3_sub_er: "L3_subsector_ER",
  stock_var: "_stock_var",
};

export interface DailyExposureHistory {
  /** Trading days in range, ascending. */
  teos: string[];
  /** symbol → variable → one value per teo (NaN where missing). */
  bySymbol: Map<string, Record<ExposurePanelVar, Float32Array>>;
}

/**
 * Read every requested name's daily values over [start, end] as typed arrays.
 *
 * The stores are chunked [all days, 64 symbols], so each needed symbol chunk
 * is fetched once per variable and every requested column is copied out of it.
 * Cost grows with the number of names, not the date range. Avoids the
 * one-object-per-cell rows of readHistorySlice, which need gigabytes for a few
 * hundred names of full history.
 */
const DAILY_READ_CONCURRENCY = 16;

async function runPool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]!();
    }
  });
  await Promise.all(workers);
}

export async function readDailyExposureHistory(params: {
  symbols: string[];
  start?: string;
  end?: string;
}): Promise<DailyExposureHistory | null> {
  const prefix = await resolveZarrGcsPrefix(); // both stores from one release
  const hedge = await openZarrGroup(zarrHedgeBasename(), prefix);
  const rets = await openZarrGroup(zarrReturnsBasename(), prefix);
  if (!hedge || !rets) return null;
  const teosAll = await readTeoStrings(hedge);
  const retTeos = await readTeoStrings(rets);
  const hSym = await readSymbolIndexMap(hedge);
  const rSym = await readSymbolIndexMap(rets);
  if (!teosAll?.length || !retTeos?.length || !hSym || !rSym) return null;

  const t0 = params.start ? lowerBound(teosAll, params.start) : 0;
  const t1 = params.end ? upperBoundInclusive(teosAll, params.end) : teosAll.length - 1;
  if (t1 < t0) return { teos: [], bySymbol: new Map() };
  const teos = teosAll.slice(t0, t1 + 1);
  const T = teos.length;
  // The returns store shares the hedge store's day axis; map by date to be safe.
  const r0 = lowerBound(retTeos, teos[0]!);
  const r1 = upperBoundInclusive(retTeos, teos[T - 1]!);

  const bySymbol = new Map<string, Record<ExposurePanelVar, Float32Array>>();
  for (const s of params.symbols) {
    if (hSym.has(s)) bySymbol.set(s, {} as Record<ExposurePanelVar, Float32Array>);
  }

  async function readInto(
    grp: Group<Readable>,
    varName: string,
    symIdx: Map<string, number>,
    out: ExposurePanelVar,
    rowStart: number,
    rowEnd: number,
    rowTeos: string[],
  ): Promise<Array<() => Promise<void>>> {
    const arr = await open.v2(grp.resolve(varName), { kind: "array" });
    const chunkW = (arr.chunks?.[1] as number | undefined) ?? 64;
    const groups = new Map<number, Array<[string, number]>>();
    for (const s of bySymbol.keys()) {
      const j = symIdx.get(s);
      if (j === undefined) continue;
      const c = Math.floor(j / chunkW);
      (groups.get(c) ?? groups.set(c, []).get(c)!).push([s, j]);
    }
    // Align the source rows to `teos` by date (identical axes in practice).
    const pos = new Map(rowTeos.slice(rowStart, rowEnd + 1).map((d, i) => [d, i] as const));
    const tasks = [...groups].map(([c, members]) => async () => {
      const c0 = c * chunkW;
      const c1 = Math.min(c0 + chunkW, (arr.shape?.[1] as number | undefined) ?? c0 + chunkW);
      const ch = await get(arr, [slice(rowStart, rowEnd + 1), slice(c0, c1)]);
      const d = ch.data as Float32Array;
      const w = c1 - c0;
      for (const [s, j] of members) {
        const col = new Float32Array(T).fill(NaN);
        for (let t = 0; t < T; t++) {
          const r = pos.get(teos[t]!);
          if (r !== undefined) col[t] = d[r * w + (j - c0)]!;
        }
        bySymbol.get(s)![out] = col;
      }
    });
    return tasks;
  }

  // One task per (variable, symbol chunk); run them DAILY_READ_CONCURRENCY at a time.
  // Sequential reads were ~0.2 s per chunk: 76 s for 25 names.
  const taskLists = await Promise.all([
    ...(Object.entries(DAILY_HEDGE_VARS) as Array<[ExposurePanelVar, string]>).map(([out, src]) =>
      readInto(hedge, src, hSym, out, t0, t1, teosAll),
    ),
    readInto(rets, "lstar_level", rSym, "lstar_level", r0, r1, retTeos),
  ]);
  await runPool(taskLists.flat(), DAILY_READ_CONCURRENCY);
  // lstar_level 0 = no recommendation.
  for (const v of bySymbol.values()) {
    const l = v.lstar_level;
    if (l) for (let t = 0; t < l.length; t++) if (l[t] === 0) l[t] = NaN;
  }
  return { teos, bySymbol };
}
