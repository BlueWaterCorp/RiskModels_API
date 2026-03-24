# Changelog

All notable changes to the RiskModels API surface and public assets.

## [Unreleased]

### Changed

- **MCP data sync** — Ran `sync-mcp-from-risk-models.sh`; `mcp-server/data/capabilities.json`, `schema-paths.json`, and `schemas/*.json` mirrored from Risk_Models `riskmodels_com` generator output.

### Added

- **Python SDK (`packages/riskmodels`)** — `riskmodels-py` on PyPI layout: `RiskModelsClient` (Bearer + OAuth2 client credentials, optional `httpx` injection for tests), batch portfolio weighted hedge ratios, Parquet/CSV tabular paths, optional `[xarray]` `get_dataset`, agent helpers (`discover` Markdown/JSON, `to_llm_context`, attrs + ERM3 legend, ticker alias map e.g. GOOGL→GOOG, `validate=warn|error|off`). See [packages/riskmodels/README.md](packages/riskmodels/README.md).

- **Agentic API landing page integration** — Homepage now features agentic-first messaging with new sections:
  - `AgenticSection` component with "Stop Querying. Start Delegating." value proposition
  - `UseCases` component highlighting four agentic patterns (Pre-Trade Risk Check, Drift Monitoring, Hedge Recommendations, Rebalance Triggers)
  - `ComparisonTable` component with competitive pricing vs MSCI Barra and Northfield
  - Updated `Hero` with "First Agentic Risk API" badge and new headline
  - Quickstart page now includes Agentic API examples (Python/TypeScript)
  - Cross-linking between traditional REST API and agentic delegation workflows

- **`GET /api/health` T coverage** — Response includes `teo_coverage` (`latest_teo`, `latest_teo_coverage_pct`, `non_null_returns_symbol_count`, `universe_stock_count`, `eodhd_latest_session_pending`) derived from `security_history` `returns_gross` vs `symbols` (stocks), using the same 10% sparse threshold as ERM3 EODHD T coverage. `health-v1.json` schema updated; copy synced to Risk_Models.

### Changed

- **OpenAPI tabular exports** — Finalized Parquet/CSV documentation: `application/vnd.apache.parquet` (matches runtime `Content-Type`), shared `FormatQueryTabular` parameter, row schemas `GrossReturnDailyRow` and `BatchAnalyzeExportRow`, `TickerReturnsDailyRow.price_close`, batch export semantics (returns-only long table), CSV examples, and `build:openapi` now mirrors `mcp-server/data/openapi.json`.

## [0.2.0] — 2026-03-24

### Added

- **Developer portal** — Global search over documentation and primary routes (Fuse.js, ⌘K / Ctrl+K). Persistent **Live Demo** control in the top bar that opens a panel with the public demo API key (when `NEXT_PUBLIC_DEMO_API_KEY` is set), one-click copy, and a link to Quickstart; without the env var, Live Demo links to Quickstart. Navbar uses backdrop blur, subtle shadow, gradient primary CTA, and active-route highlighting for clearer hierarchy.

### Changed

- **`riskmodels-py` 0.2.0** (package `packages/riskmodels`) — Version and `__version__` bumped from 0.1.0. **`RiskModelsClient.analyze`** is a documented alias for **`analyze_portfolio`**. **`get_dataset`** (aliases **`get_cube`**, **`get_panel`**) returns an **`xarray.Dataset`** from batch Parquet/CSV long tables when the **`[xarray]`** extra is installed. PyPI trove classifier **Development Status :: 4 - Beta** (was Alpha).

## [2026-03-23] — Phase 2–4 migration: self-contained API

### Added

- **Full agent middleware stack** (`lib/agent/`) — billing, billing-middleware, api-keys, capabilities, cost-estimator, errors, free-tier, rate-limiter, response-utils, schemas, telemetry. All `createAdminClient` calls use `@/lib/supabase/admin`; module-scope singleton anti-patterns removed throughout.
- **DAL layer** (`lib/dal/`) — `risk-engine-v3`, `risk-metadata`, `response-headers`, `secmaster`; direct Supabase queries replacing former gateway HTTP calls.
- **Format response helper** (`lib/api/format-response.ts`) — JSON/Parquet/CSV output.
- **L3 service** (`lib/risk/l3-decomposition-service.ts`) — shared decomposition logic used by route and MCP tools.
- **Redis cache** (`lib/cache/redis.ts`) — Upstash Redis client with in-memory fallback.
- **13 API routes** — `/ticker-returns`, `/l3-decomposition`, `/batch/analyze`, `/metrics/[ticker]`, `/tickers`, `/estimate`, `/health`, `/balance`, `/telemetry`, `/cli/query`, `/auth/provision`, `/auth/provision-free`, `/auth/free-tier-status`.
- **OpenAPI spec** — server URL updated to `https://riskmodels.app/api`; added `/auth/provision-free`, `/auth/free-tier-status`, `/cli/query` path entries.

### Added

- **ERM3 zarr ↔ API ER/HR mapping** — [docs/ERM3_ZARR_API_PARITY.md](docs/ERM3_ZARR_API_PARITY.md) documents zarr-style `L*_ER` / `L*_HR` names vs `POST /batch/analyze` keys (`full_metrics` / `hedge_ratios`), `metrics` whitelist behavior, lineage headers, tolerances, and an example JSON. OpenAPI `BatchFullMetrics` / `BatchHedgeRatios` now describe the full L1/L2/L3 surface and zarr aliases; `BatchAnalyzeResponse` may include `_metadata`.
- **Developer Portal (riskmodels.app)** — Next.js site with auth (GitHub + magic link), Stripe Setup for $20 free credits, API key generation with one-time reveal, methodology docs with KaTeX, API reference, quickstart, examples. Get keys at riskmodels.app/get-key.
- **Vercel deployment** — `DEPLOYMENT.md` with env vars, Supabase/Stripe config; `vercel.json`, `.env.example`; `getAppUrl()` fallback to `VERCEL_URL` for preview deployments.
- **Parquet/CSV format support** — `?format=parquet` or `?format=csv` on `/ticker-returns`, `/returns`, `/etf-returns`; POST body `format` on `/batch/analyze`. Returns binary Parquet or text CSV for bulk export.
- **Cost estimation endpoint** — `POST /api/estimate` returns predicted cost before a request. Authenticated, free.

### Changed

- **Lineage metadata** — All data responses include `_metadata` (model_version, data_as_of, factor_set_id, universe_size, wiki_uri, factors) and headers `X-Risk-Model-Version`, `X-Data-As-Of`, `X-Factor-Set-Id`, `X-Universe-Size`.
- **Billing** — Four previously unbilled endpoints now use `withBilling()`: `metrics/[ticker]` ($0.001), `l3-decomposition` ($0.005), `portfolio/returns` ($0.002/position), `portfolio/risk-index` ($0.005).
- **CORS** — ticker-returns and etf-returns now include CORS headers for browser requests.
- **ETag / 304** — ticker-returns supports `If-None-Match`; returns 304 Not Modified when cached data is fresh.
- **CLI** — `riskmodels estimate` subcommand for pre-flight cost estimates.
