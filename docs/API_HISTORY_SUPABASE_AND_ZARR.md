# API history: Supabase vs Zarr (approved architecture)

**Status:** Approved  
**Updated:** 2026-04-14  

## Policy (pure Zarr for range history)

- **Range-based daily history** for standard V3 metrics is served **only from consolidated Zarr v2** on Google Cloud Storage (internal prefix configured via `ZARR_GCS_PREFIX` / `ZARR_FACTOR_SET_ID`; see [`lib/zarr-config.ts`](../lib/zarr-config.ts)). Datasets mirror `sdk/riskmodels/snapshots/zarr_context.py`: **`ds_daily.zarr`**, **`ds_erm3_returns_{FACTOR_SET}.zarr`**, **`ds_erm3_hedge_weights_{FACTOR_SET}.zarr`** (default factor set `SPY_uni_mc_3000`).
- **Supabase** remains the source for **hot paths**: `security_history_latest`, rankings metric keys, **monthly** periodicity (e.g. hierarchical betas), unknown metric keys, and **`fetchLatestMetrics` / `fetchRankingsFromSecurityHistory`** EAV fallbacks.
- **Symbology:** Zarr slices use the same internal **`symbol`** (`bw_sym_id`) as `public.symbols` / Supabase sync.
- **Privacy:** Responses, client-visible errors, and public logs must **never** include `gs://`, bucket names, zarr filenames, or GCS object paths. Internal server logs use generic markers only (e.g. `[zarr-internal]`).
- **Lineage:** JSON `_metadata` (via `buildMetadataBody`) includes optional **`data_source`**: `"zarr"` \| `"supabase"` and optional **`range`**: `[ISO start, ISO end]` for history payloads. See [`RESPONSE_METADATA.md`](../RESPONSE_METADATA.md).

## Deprecated

- **Hybrid Option B** (cutover date between Supabase and Zarr for the same route) is **deprecated**. History routes use a **single** backend per request: Zarr for eligible daily keys, Supabase otherwise—no stitch/merge by date.

## Implementation checklist

1. **Metric registry** — [`lib/dal/zarr-metric-registry.ts`](../lib/dal/zarr-metric-registry.ts) maps each `V3MetricKey` to dataset role and zarr variable (including `level` for `ds_erm3_returns`).
2. **Chunk-aware reader** — [`lib/dal/zarr-reader.ts`](../lib/dal/zarr-reader.ts): `@google-cloud/storage` + `zarrita`, consolidated metadata, `teo` range slicing, per-symbol index from coordinate arrays.
3. **DAL routing** — [`lib/dal/risk-engine-v3.ts`](../lib/dal/risk-engine-v3.ts): `fetchHistory` / `fetchBatchHistory` → Zarr when `isZarrHistoryPath(...)`; `fetchHistoryFromSupabase` for rankings/latest-metrics EAV paths.
4. **Cache** — Upstash / in-memory via [`lib/cache/redis.ts`](../lib/cache/redis.ts) on hashed `(symbols, keys, start, end, periodicity, factor_set_id)` with short TTL.
5. **Runtime** — Routes that call the reader use **Node.js** runtime (`export const runtime = "nodejs"`), not Edge.
6. **Contract tests** — Cross-check slices against `sdk/scripts/mag7_dd_zarr_vs_api.py` and Python `zarr_context.py` for parity.

## Related documentation

| Doc | Location |
|-----|----------|
| **Deploy API + Zarr GCS (steps 1–2 → Vercel/Doppler)** | [`DEPLOY_ZARR_GCS_API.md`](./DEPLOY_ZARR_GCS_API.md) |
| Field / zarr ↔ API naming | [`ERM3_ZARR_API_PARITY.md`](./ERM3_ZARR_API_PARITY.md), [`SEMANTIC_ALIASES.md`](../SEMANTIC_ALIASES.md) |
| Supabase schema | [`SUPABASE_TABLES.md`](../SUPABASE_TABLES.md) |
| Zarr vs API reconciliation | [`ZARR_API_RECONCILIATION_STATE.md`](./ZARR_API_RECONCILIATION_STATE.md) |
| ERM3 GCS layout | ERM3 repo `docs/config/GCS_PATH_PREFIX.md` |

---

*ERM3 pipeline and Supabase sync jobs are unchanged; they continue to populate both Zarr and DB independently.*
