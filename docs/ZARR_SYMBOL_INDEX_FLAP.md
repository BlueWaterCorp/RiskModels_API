# Zarr history read path — post-mortem (resolved 2026-04-14)

Companion to [`CACHE_EMPTY_PAYLOAD_FIXES.md`](./CACHE_EMPTY_PAYLOAD_FIXES.md). Originally opened as "symbol-index flap" during triage; the actual root cause turned out to be three distinct dtype/indexing bugs in the TypeScript zarr reader, not an ERM3 sync race. Left in docs/ because the investigation path is itself useful for the next time a zarr read regression shows up.

## Symptom (what the user saw)

`/api/ticker-returns?ticker=NVDA&years=1&format=json` and `/api/l3-decomposition?ticker=NVDA` were returning 200 with empty `data: []` for **every** ticker, not just NVDA. `data_source` showed `"zarr"` in the response metadata, so the zarr read path was being consulted — it just came back empty.

Reproduced live against `riskmodels.app` (pre-fix):

| # | HTTP | Bytes | Latency | `data.length` |
|---|---|---|---|---|
| 1 | 200 | 435 | 25.7s | 0 |
| 2 | 200 | 435 | 12.2s | 0 |
| 3 | 200 | 95528 | 5.4s | 250 |

~1 in 3 calls returned real data. Also reproduced with MPC, AAPL. The latency-varying pattern initially looked like a transient flap; it was actually a combination of:

1. Redis cache occasionally serving a warm pre-rotation payload (the `data: 250` case) — explains the one-in-three success.
2. The dead Supabase EAV fallback (removed in `d7b382a`) running a 12–25s security_history scan for metric_keys it didn't carry (the slow-empty cases).
3. Once the fallback was removed, the zarr miss paid nothing — just a fast 3–5s empty response from the GCS read path. Empty all the time, visible as soon as the cache cooled after an Upstash credential rotation.

## The three bugs

All in `lib/dal/zarr-reader.ts`. Fixed in commit `fix(zarr): decode symbol/teo correctly and align per-store indices`.

### 1. `readSymbolIndexMap` / `readLevelIndexMap` only handled `UnicodeStringArray`

The GCS stores write `symbol`, `ticker`, and `level` as numpy `dtype=object` (variable-length strings). zarrita.js decodes those as plain `Array<string>`, not `UnicodeStringArray`. The `instanceof UnicodeStringArray` check returned `null`; the outer `readHistorySlice` bailed at the `!symMap?.size` check.

Fix: add an `Array.isArray(d)` branch that builds the Map with `d[i]` indexed access.

### 2. `readTeoStrings` misinterpreted CF-encoded int64 day offsets as nanosecond epochs

The `teo` coordinate on all three stores is int64 with a CF attribute:

```
calendar: proleptic_gregorian
units:    "days since 2006-04-17 00:00:00"
values:   [0, 1, 2, 3, 4, ..., 7297, 7298, 7301]
```

Python xarray decodes this into real `datetime64[ns]` via CF convention. The TypeScript reader assumed `ns / 1_000_000n` and mapped every raw day-offset to epoch ms ≈ 0, producing 5029 copies of `"1970-01-01"`. Even if Bug 1 had been fixed in isolation, `lowerBound(teo, "2025-04-14")` against a uniformly-1970 array returns `teo.length`, producing an empty slice.

Fix: read `arr.attrs.units`, parse `"days since YYYY-MM-DD[ HH:MM:SS]"`, and map each int64 value to `base + v * 86_400_000` ms. Legacy `nsToIsoDate` kept as fallback in case a future store writes datetime64[ns].

### 3. `readHistorySlice` aliased a single `symbolIndex` and `[t0, t1)` across all three stores

The three zarr stores have independent rosters and time axes:

```
ds_daily.zarr                              : 15306 symbols, 5029 teo  (NVDA → 727)
ds_erm3_hedge_weights_SPY_uni_mc_3000.zarr :  5963 symbols, 5033 teo  (NVDA → 133)
ds_erm3_returns_SPY_uni_mc_3000.zarr       :  5963 symbols, 4768 teo  (NVDA → 133)
```

The pre-fix function built one `symMap` from the daily store and reused the derived `symbolIndex` to index into the hedge and returns arrays at lines 384 and 404. It also reused daily-derived `[t0, t1)` bounds to slice time axes of different lengths and possibly different base dates.

This was latent as long as Bugs 1 and 2 were in place — the function never reached the hedge/returns branches. Fixing Bugs 1+2 without 3 would have converted empty-responses into silently-wrong data: NVDA's L3 metrics served from position 727 in a 5963-entry hedge array, etc. Worse outcome than the bug it would have "fixed."

Fix: per-store `symMap` and `teo` independently, per-store `[t0, t1)` bounds, and a "shortest common range" intersection so every returned row lives in a window that all involved stores cover.

## Validation

`scripts/diagnose-zarr-decode.mjs` — Node diagnostic that opens the real GCS stores, exercises the fixed decode paths inline, and does a full NVDA round-trip across daily (`return`), hedge (`L3_market_HR`), and returns (`combined_factor_return` level=subsector). Expected output ends in `PASS` with 250 non-null values from each store and first-value parity against a cached successful API response.

Run it any time a zarr read regression is suspected — the dtype / coord / axis dump at the top also serves as a readable snapshot of the current store shape for future debugging.

## What we ruled out along the way

Kept here because the investigation path is non-obvious:

- **ERM3 sync race between the three stores.** The original hypothesis. Ruled out once we confirmed AAPL (not just NVDA) was also empty — sync races would hit specific symbols, not every ticker universally.
- **`swap_dims(symbol, ticker)` missing on the write side.** Close to the right area — the stores do use `symbol` as dim with `ticker` as a non-dim coord — but the Python SDK (`sdk/riskmodels/snapshots/zarr_context.py:171-182`) and the GCS stores both use the same convention, so the dim layout isn't the issue. The issue was one layer deeper: the encoding of those coordinate arrays.
- **Stale / legacy zarr at `/zarr/ds_daily.zarr`.** Initial local inspection of the non-`eodhd` path turned up `K7TPSX-R`-style fsym_ids and sent the investigation down a dead end. The API reads `rm_api_data/eodhd/` per `lib/zarr-config.ts:9`; the non-`eodhd` local mirror is a historical artifact that nothing current uses.
- **`fetchHistoryFromSupabase` as a legitimate fallback.** The pre-fix code "fell back" to Supabase EAV on zarr-empty, but the L3 metric keys never lived in `security_history`. That fallback was dead code that turned a zarr miss into 12-25s of wasted EAV scanning followed by a silent empty-success. Removed in commit `d7b382a` before the real fix.

## Why it became visible when it did

The latent dtype bugs were introduced in the zarr-integration commit `67b9a26`. Before the Upstash rotation the route's Redis cache hid them — warm responses answered most requests before ever calling the zarr reader. Post-rotation the cache was cold, organic traffic had to run the full compute path, and the three bugs surfaced together within minutes.

The `CACHE_EMPTY_PAYLOAD_FIXES.md` guards are what kept the post-rotation cache from re-poisoning itself with empty responses — without those guards, the flap would have been much worse because the cold cache would have written 5-minute-TTL empties on every read.

## Still open

- **Cache warm-up after deploy.** The fix puts the reader back in working order, but the post-rotation Redis is still mostly cold. Organic traffic will re-warm it, or you can run a scripted warmer against the hot ticker set. No correctness issue either way; just a latency story for the first hour or so.
- **CI-level live validation.** The `.github/workflows/smoke-test.yml` step added in `ci(smoke): add /api/ticker-returns data-plane check with retries` will catch a recurrence against the deployed API, but it won't catch a zarr-store dtype regression if Redis is still serving warm responses. Consider adding a bypass-cache variant on a weekly schedule.

## Related files

| Area | File |
|---|---|
| Zarr reader (fixed) | `lib/dal/zarr-reader.ts` |
| Metric → store routing | `lib/dal/zarr-metric-registry.ts` |
| Zarr config / store names | `lib/zarr-config.ts` |
| Diagnostic / integration check | `scripts/diagnose-zarr-decode.mjs` |
| Python SDK reference | `sdk/riskmodels/snapshots/zarr_context.py` |
| Authoritative history routing doc | `docs/API_HISTORY_SUPABASE_AND_ZARR.md` |
