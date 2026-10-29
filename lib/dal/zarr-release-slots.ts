/**
 * Release-slot resolution for the stocks-side zarr tree (ERM3-75 increment 5).
 *
 * The publisher uploads a release into the inactive slot
 * (`{base}/slots/{a,b}/<store>.zarr`) and then flips `{base}/CURRENT`
 * atomically, so a reader that resolves the base through CURRENT sees one
 * whole release, never a mix of stores mid-upload. Rollback is CURRENT
 * pointing back at the other slot.
 *
 * `resolveZarrGcsPrefix()` is what every stocks-side reader calls in place of
 * the synchronous `parseZarrGcsPrefix()`:
 *   - switch off (`ZARR_GCS_RELEASE_SLOTS` unset, the default): the fixed
 *     base from ZARR_GCS_PREFIX, exactly as before, no GCS call;
 *   - switch on: CURRENT is read once per `ZARR_GCS_CURRENT_TTL_MS` (60 s)
 *     and the slot base is returned; if CURRENT is absent or unreadable the
 *     last good answer is kept, else the fixed base (the publisher mirrors it).
 *
 * The per-reader group caches (30 min) key on the store basename, so a flip
 * becomes visible to a reader when its group cache expires or the process
 * restarts; a slot is not overwritten for two publishes, so a group opened
 * on the previous slot stays consistent for that window.
 *
 * Never put bucket names or object paths in thrown errors or API JSON.
 */

import { Storage } from "@google-cloud/storage";
import {
  parseZarrGcsPrefix,
  parseZarrCurrentPointer,
  zarrCurrentObjectPath,
  zarrCurrentTtlMs,
  zarrReleaseSlotsEnabled,
  zarrSlotBasePath,
} from "@/lib/zarr-config";

export interface ZarrGcsPrefix {
  bucket: string;
  basePath: string;
}

/** Reads one small text object; null when it does not exist. Injected in tests. */
export type CurrentFetcher = (bucket: string, objectPath: string) => Promise<string | null>;

let _storage: Storage | null = null;

function getGcs(): Storage {
  if (!_storage) {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        const credentials = JSON.parse(raw) as Record<string, unknown>;
        _storage = new Storage({ credentials });
      } catch {
        console.error("[zarr-slots] GCP_SERVICE_ACCOUNT_JSON parse failed");
        _storage = new Storage();
      }
    } else {
      const keyFile = process.env.RISKMODELS_GCS_KEYFILE?.trim();
      _storage = keyFile ? new Storage({ keyFilename: keyFile }) : new Storage();
    }
  }
  return _storage;
}

const defaultFetcher: CurrentFetcher = async (bucket, objectPath) => {
  try {
    const [buf] = await getGcs().bucket(bucket).file(objectPath).download();
    return buf.toString("utf8");
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 404) return null;
    throw new Error("CURRENT read failed");
  }
};

interface CacheEntry {
  key: string;
  at: number;
  prefix: ZarrGcsPrefix;
}

let _cache: CacheEntry | null = null;
let _inflight: Promise<ZarrGcsPrefix> | null = null;

/** Test hook: forget the resolved CURRENT. */
export function resetZarrReleaseSlotCache(): void {
  _cache = null;
  _inflight = null;
}

async function resolveUncached(
  fixed: ZarrGcsPrefix,
  fetcher: CurrentFetcher,
): Promise<ZarrGcsPrefix> {
  const objectPath = zarrCurrentObjectPath(fixed.basePath);
  const text = await fetcher(fixed.bucket, objectPath);
  if (text === null) {
    console.warn("[zarr-slots] CURRENT absent; using the fixed prefix");
    return fixed;
  }
  const ptr = parseZarrCurrentPointer(text);
  if (!ptr) {
    console.error("[zarr-slots] CURRENT is not a slot pointer; using the fixed prefix");
    return fixed;
  }
  return { bucket: fixed.bucket, basePath: zarrSlotBasePath(fixed.basePath, ptr.slot) };
}

/**
 * The GCS prefix stocks-side readers open stores under. With the switch off
 * this is `parseZarrGcsPrefix()`; with it on, the slot CURRENT points at.
 */
export async function resolveZarrGcsPrefix(opts?: {
  fetcher?: CurrentFetcher;
  now?: () => number;
}): Promise<ZarrGcsPrefix> {
  const fixed = parseZarrGcsPrefix();
  if (!zarrReleaseSlotsEnabled()) return fixed;

  const now = opts?.now ?? Date.now;
  const key = `${fixed.bucket}/${fixed.basePath}`;
  const t = now();
  if (_cache && _cache.key === key && t - _cache.at < zarrCurrentTtlMs()) {
    return _cache.prefix;
  }
  if (_inflight) return _inflight;

  const fetcher = opts?.fetcher ?? defaultFetcher;
  _inflight = (async () => {
    try {
      const prefix = await resolveUncached(fixed, fetcher);
      _cache = { key, at: t, prefix };
      return prefix;
    } catch {
      // keep the last good answer for one more TTL; otherwise the fixed prefix (mirrored by the publisher)
      if (_cache && _cache.key === key) {
        console.error("[zarr-slots] CURRENT read failed; keeping the last resolved slot");
        _cache = { ..._cache, at: t };
        return _cache.prefix;
      }
      console.error("[zarr-slots] CURRENT read failed; using the fixed prefix");
      return fixed;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
