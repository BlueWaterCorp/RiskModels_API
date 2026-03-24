# Changelog

All notable changes to the RiskModels API surface and public assets.

## [Unreleased]

### Added

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
