# Cache and empty-payload fixes (2026-04)

This note records bugs fixed in the RiskModels API codebase where **empty or invalid values were treated as successful cache hits** or **stored in Redis**, freezing bad state for the TTL (same failure mode as serving empty `/ticker-returns` `data: []` until expiry).

## 1. Zarr history slice (`lib/dal/zarr-reader.ts`)

**Issue:** In JavaScript, `[]` is truthy. The Redis fast path used `if (hit && hit.rows)`, so a cached `{ rows: [] }` was treated as a **cache HIT** and skipped fresh zarr/Supabase reads. Empty results were also **written** to Redis.

**Fix:**

- Treat as a hit only when `hit?.rows?.length > 0`.
- Call `setCache` only when `rows.length > 0`.

## 2. Snapshot API cache HIT guards (`lib/cache/snapshot-payload-guards.ts`)

**Issue:** Routes used `if (hit)` after `getCache`. A corrupted or partial payload (e.g. `{ base64: "" }`) is still truthy and could be served as PNG/PDF.

**Fix:** Shared validators:

- `isDdSnapshotCacheHit` — DD snapshot from GCS (`base64` + `contentType` non-empty).
- `isRasterSnapshotCacheHit` — single-ticker PNG/PDF (`base64` non-empty).
- `isPortfolioRiskSnapshotCacheHit` — portfolio risk snapshot JSON/PNG/PDF shapes with non-empty body or `base64`.

**Routes updated:**

- `app/api/snapshot/[ticker]/route.ts`
- `app/api/metrics/[ticker]/snapshot.png/route.ts`
- `app/api/metrics/[ticker]/snapshot.pdf/route.ts`
- `app/api/portfolio/risk-snapshot/route.ts`

**Tests:** `tests/snapshot-cache-payload-guards.test.ts`

## 3. `getOrCompute` (`lib/cache/redis.ts`)

**Issue:** Documented that **`[]` is truthy** and will be returned if stored; callers with array payloads must validate length or avoid caching empty slices.

**Fix:** Cache hit condition is `cached !== null && cached !== undefined` so an undefined read does not get treated as a stored value.

## 4. Macro factor maps (`lib/risk/factor-correlation-service.ts`)

**Issue:** `getMacroFactorMapsCached` used `getOrCompute`. When `loadMacroFactorMaps` returned an empty `Map` (DB error or no rows), it serialized to **`{}`** and was cached for `CACHE_TTL.DAILY`, freezing transient failures.

**Fix:**

- Explicit `getCache` → load → `setCache`.
- `macroFactorCachePayloadHasData` (type guard): only use Redis as a HIT when the plain object has at least one factor key.
- **Never** `setCache` when the serialized payload is empty `{}`.

**Tests:** `tests/macro-factor-cache-payload.test.ts`

## 5. `warmCache` (`lib/cache/redis.ts`)

**Issue:** Any fetcher return value was written, including `null`, `{}`, `[]`, empty buffers, etc.

**Fix:**

- `isSkippableCacheWarmPayload` — skip `setCache` for nullish, empty string/array/plain object, empty Map/Set/Uint8Array/Buffer.
- Log: `[Cache] warmCache skipped (empty payload): <key>`.

**Tests:** `tests/cache-warm-skip.test.ts`

## Operational follow-up

- **Empty `/ticker-returns`** for otherwise valid tickers is often a **data plane** issue (zarr + `security_history`), not fixed by these cache changes alone. After deploy, re-check live responses; if `data` is still `[]`, investigate ERM3 sync and symbol↔zarr alignment.
- Consider a **smoke test** in CI or monitoring: `GET /api/ticker-returns?ticker=NVDA&years=1&format=json` with `data.length > 0`.

## Related files (quick index)

| Area | File |
|------|------|
| Zarr + Redis | `lib/dal/zarr-reader.ts` |
| Snapshot guards | `lib/cache/snapshot-payload-guards.ts` |
| Redis helpers | `lib/cache/redis.ts` |
| Macro factors | `lib/risk/factor-correlation-service.ts` |
