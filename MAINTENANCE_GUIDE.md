# Maintainer guide (RiskModels_API)

Short reference for operators working on the public API repo while Vercel is live. End-user agent instructions stay in [AGENTS.md](./AGENTS.md); deeper repo-sync rules live in [SKILL.md](./SKILL.md) and [.agents/skills/repo-sync/SKILL.md](./.agents/skills/repo-sync/SKILL.md).

## Local API (fast iteration)

1. **Run the app** from the repo root: `npm run dev` → routes under **`http://localhost:3000/api/*`** (same surface as production).
2. **Point the Python SDK / scripts at localhost** — in `.env.local` set:
   - `RISKMODELS_BASE_URL=http://localhost:3000/api`
   - `RISKMODELS_API_KEY=...` (a key your local app can validate; usually the same shape as prod if you use the same Supabase project and key hashing envs).
3. **`load_repo_dotenv()`** (SDK) and `scripts/generate_readme_assets.py` read `.env.local`, so no extra `export` is needed once the file is saved.
4. **Data dependencies** — correlation, rankings, metrics, etc. still call Supabase and Redis configured in `.env.local`. Point `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` at a dev project or the real project; without valid DB data, routes may 404/500 even when code is correct.
5. **Iterate** — edit route handlers under `app/api/`, save, hit the same path via the SDK or `curl`; no deploy cycle.

CORS already allows `http://localhost:3000` for browser clients ([`lib/cors.ts`](./lib/cors.ts)).

## Vercel and environment

- Full variable list and Doppler/CLI flows: [DEPLOYMENT.md](./DEPLOYMENT.md).
- **`npm run vercel:sync-env`** only uploads an allowlisted subset from `.env.local` ([`scripts/sync-env-to-vercel.sh`](./scripts/sync-env-to-vercel.sh)). Set other secrets (e.g. `API_KEY_SECRET`) manually in Vercel or via Doppler’s Vercel integration.
- **Gateway:** `RISKMODELS_API_SERVICE_KEY` authorizes trusted server-to-server access to gateway-style routes ([`lib/gateway-auth.ts`](./lib/gateway-auth.ts)).

## Webhooks (outbound)

- Operator guide (not in the public clone): `internal/WEBHOOKS_GUIDE.md` — **gitignored**; see [`internal/README.md`](./internal/README.md).
- Apply [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql) on Supabase before relying on subscription APIs.
- Signing uses **per-subscription secrets** in the database, not a global webhook env var ([`DEPLOYMENT.md`](./DEPLOYMENT.md) webhooks subsection).

## Cross-repo drift (RiskModels_API vs Risk_Models)

- CI: [`.github/workflows/drift-detection.yml`](./.github/workflows/drift-detection.yml) compares canonical schemas and OpenAPI when relevant paths change (requires `REPO_ACCESS_TOKEN` for the private Risk_Models checkout).
- When you change `mcp/data/schemas/*`, `schema-paths.json`, or `OPENAPI_SPEC.yaml`, follow [.cursor/rules/repo-sync-enforcer.mdc](./.cursor/rules/repo-sync-enforcer.mdc) and update Risk_Models copies as documented in the skill.

## MCP data sync from Risk_Models

- Script: [`sync-mcp-from-risk-models.sh`](./sync-mcp-from-risk-models.sh) (run from repo root). It runs `generate-mcp-data` in `riskmodels_com` and copies `mcp-server/data` into this repo’s `mcp/data/`.
- [`mcp/README.md`](./mcp/README.md) describes the MCP package and when to refresh static data.

## Optional tooling

- **`npx repomix`** can pack the repo for LLM context; it is **not** required for drift detection or CI.
- **`GET /api/health`** exposes service health via [`lib/agent/telemetry`](./lib/agent/telemetry.ts); treat any third-party “data vendor completeness” claims as documentation-only unless reflected in the actual JSON response. This is also the liveness probe consumed by the RM_ORG marketing site — **do not** use `/metrics/beta-gaps` for liveness, it is a data endpoint and can legitimately 404.

---

## Zarr read path gotchas (2026-04-14 post-mortem)

The TypeScript zarr reader at [`lib/dal/zarr-reader.ts`](./lib/dal/zarr-reader.ts) is the single point of contact between the API and the ERM3 GCS zarr stores. It has three tight assumptions about the store layout that have broken in subtle ways before and will again if ERM3 changes its write pipeline without coordinating. See the full write-up at [`docs/ZARR_SYMBOL_INDEX_FLAP.md`](./docs/ZARR_SYMBOL_INDEX_FLAP.md).

### The four stores (prod: `gs://rm_api_data/eodhd/`)

| Store | Roster | Roles | Notes |
|---|---|---|---|
| `ds_daily.zarr` | ~15k US stocks | `daily` | OHLCV + `return` only; **no L3 vars** |
| `ds_etf.zarr` | ~100 ETFs | `daily` | Disjoint roster from stocks; same OHLCV shape |
| `ds_erm3_hedge_weights_{FACTOR_SET}.zarr` | ~6k mc_3000 subset | `hedge` | L1/L2/L3 HR/ER vars + `_stock_var` |
| `ds_erm3_returns_{FACTOR_SET}.zarr` | ~6k mc_3000 subset | `returns` | CFR/RR over `level` dim (market/sector/subsector) |

Factor set ID lives in `ZARR_FACTOR_SET_ID` env (default `SPY_uni_mc_3000`). GCS prefix in `ZARR_GCS_PREFIX` (default `rm_api_data/eodhd`). Both in [`lib/zarr-config.ts`](./lib/zarr-config.ts).

### Assumptions that MUST stay true

1. **`symbol` dim is the identifier, `ticker` is a non-dim coord on it.** Symbol IDs are `BW-...` (Supabase `resolveSymbolByTicker` returns these verbatim). The reader maps the raw symbol string to a store-local index via `readSymbolIndexMap`.

2. **Each store's symbol roster and `teo` axis are independent** — indices from `ds_daily` ARE NOT valid against `ds_erm3_*` stores. `readHistorySlice` builds a separate `symMap` and `teoStrings` for every store and computes per-store `[t0, t1)` bounds. **Do not "optimize" by sharing.** This was bug 3 in the post-mortem.

3. **Symbol / ticker / level arrays use `dtype=object` (variable-length strings)** in production. zarrita.js decodes those as plain `Array<string>` with `d[i]` access — **not** `UnicodeStringArray` with `d.get(i)`. The reader has dual branches for both shapes. If ERM3 switches a store to fixed-width `<Un>`, the `UnicodeStringArray instanceof` branch catches it; if it switches to some third shape, `readSymbolIndexMap` returns `null` → `readHistorySlice` bails at the `!symMap?.size` check → **every ticker returns empty**. Check the reader next, not the API.

4. **`teo` is int64 with a CF time attribute** `units: "days since YYYY-MM-DD HH:MM:SS"`. `readTeoStrings` parses that attr and maps day offsets to ISO dates. Backward-compat fallback maps raw int64 as nanosecond epochs (`datetime64[ns]`), so a pipeline that accidentally drops the `units` attr produces **silently wrong dates** (everything maps near 1970-01-01). If that happens, the range slice lowerBound/upperBoundInclusive collapses and rows come back empty.

### Things you should never do

- **Do not reinstate a Supabase fallback from the zarr history path.** `security_history` does not carry the L3 metric keys. A "fallback" query to Supabase for L3 decomposition metrics runs a 12-25s EAV scan and returns zero rows — the worst of both worlds. This was removed in [`lib/dal/risk-engine-v3.ts`](./lib/dal/risk-engine-v3.ts) during the post-mortem and must stay removed. If zarr is down, let it throw and surface a 503. See [`docs/API_HISTORY_SUPABASE_AND_ZARR.md`](./docs/API_HISTORY_SUPABASE_AND_ZARR.md) for the "only from consolidated Zarr v2" rule.
- **Do not cache empty payloads.** `[]` is truthy in JavaScript; `{}` serializes the same as a missing Map; `{base64: ""}` is a valid object but a broken PNG. Every cache layer has a payload guard — do not loosen them. See [`docs/CACHE_EMPTY_PAYLOAD_FIXES.md`](./docs/CACHE_EMPTY_PAYLOAD_FIXES.md) for the full pattern.
- **Do not share a single `symbolIndex` across stores in `readHistorySlice`.** Always resolve per store.

### Diagnostic when something goes wrong

[`scripts/diagnose-zarr-decode.mjs`](./scripts/diagnose-zarr-decode.mjs) opens the live GCS stores with the exact zarrita.js setup the API uses, dumps the decoded shape of `symbol` / `ticker` / `teo` for `ds_daily.zarr`, and round-trips NVDA across daily / hedge / returns **and** SPY across `ds_etf.zarr`. Prints `PASS` / `FAIL`. Run it any time you suspect a zarr regression — faster and more targeted than spelunking through prod logs.

```bash
node scripts/diagnose-zarr-decode.mjs
```

Needs Application Default Credentials (or `GCP_SERVICE_ACCOUNT_JSON`) with read access to the zarr bucket. If it fails with a clear "FAIL — still empty" message, **check the reader's dtype dispatch before anything else** — that's the most likely culprit.

### Cache cooldown exposes latent zarr bugs

The Upstash rotation on 2026-04-14 cleared Redis and instantly surfaced three latent zarr-reader bugs (dtype dispatch, CF time units, cross-store index aliasing) that had been hidden by warm cache hits since the zarr integration landed earlier that same day. If you rotate Upstash credentials or prefix in the future:

1. **Expect latency**: every request pays a cold-zarr round-trip until Redis re-warms.
2. **Monitor `[V3 DAL] Zarr history returned empty rows` warn logs** for the first hour. A sudden spike is evidence of a latent bug being unmasked, not a caching problem.
3. **Run the smoke test workflow manually** (`.github/workflows/smoke-test.yml`) rather than waiting for the 07:00 UTC cron.

---

## Periodic audits (jules.google)

See [`docs/JULES_AUDIT_PROMPT.md`](./docs/JULES_AUDIT_PROMPT.md) for the self-contained brief. Run weekly via Jules.google to catch contract drift between the deployed API, the Python SDK, the CLI, and the MCP/OpenAPI schemas without waiting for a customer to report an outage.
