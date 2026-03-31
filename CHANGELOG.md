# Changelog

All notable changes to the RiskModels API surface and public assets.

## [Unreleased]

### Added

- **Python SDK** — `format_metrics_snapshot(row)` for human-readable L3 metrics text from a `get_metrics` dict row; `examples/quickstart.py` CLI demo. See [packages/riskmodels/README.md](packages/riskmodels/README.md).

### Changed

- **User API key billing floor** — [`ensureMinimumBalanceForUserKeyHolder`](./lib/agent/billing.ts) tops up `agent_accounts` to $20 once per user (deduped via `billing_events.capability_id = user_key_floor_credit`) for active `rm_user_*` keys; runs after [`ensureStarterCredits`](./lib/agent/billing.ts) in [`withBilling`](./lib/agent/billing-middleware.ts). Supabase migration [`20260328131000_backfill_rm_user_key_balance.sql`](./supabase/migrations/20260328131000_backfill_rm_user_key_balance.sql) backfills balance for existing key holders.

- **Stripe setup-success + agent API keys** — [`GET /api/stripe/setup-success`](./app/api/stripe/setup-success/route.ts) now inserts card-verified `rm_user_*` keys into `user_generated_api_keys` (matching [`validateApiKey`](./lib/agent/api-keys.ts)); checks for an existing active user key in that table; persists `stripe_payment_method_id` and `contact_email` on `agent_accounts`; redirects with `stripe=account_error` or `stripe=key_error` when DB writes fail instead of continuing silently. [`POST /api/agent-keys`](./app/api/agent-keys/route.ts) uses [`generateApiKey`](./lib/agent/api-keys.ts) so keys stored in `agent_api_keys` use the `rm_agent_*` format.

- **Plaid setup routes** — [`POST /api/plaid/link-token`](./app/api/plaid/link-token/route.ts) and [`POST /api/plaid/exchange-public-token`](./app/api/plaid/exchange-public-token/route.ts) use [`withBilling`](./lib/agent/billing-middleware.ts) with `skipBilling: true` and new capabilities `plaid-link-token` / `plaid-exchange-public-token` so responses get `X-Request-ID`, latency, and zero-cost headers like other instrumented routes.

- **OpenAPI `GET /health`** — Response schema documents optional `macro_factors` (status, `latest_teos`, row counts, staleness) aligned with [`getHealthStatus`](./lib/agent/telemetry.ts).

- **Python SDK** — `RiskModelsClient.get_plaid_holdings()` (`GET /plaid/holdings`); discover snippet and capability entry.

- **Macro factor correlation (docs & OpenAPI)** — [`SEMANTIC_ALIASES.md`](./SEMANTIC_ALIASES.md) macro-factor section; [`content/docs/api.mdx`](./content/docs/api.mdx) Risk Metrics card (`#risk-metrics`); [`lib/portal-search-index.ts`](./lib/portal-search-index.ts) discovery keywords + search item; [`README_API.md`](./README_API.md) core endpoint row. OpenAPI: `externalDocs` on `POST /correlation` and `GET /metrics/{ticker}/correlation` pointing at [`factor-correlation-v1.json`](./mcp/data/schemas/factor-correlation-v1.json); GET documents `factor` as a synonym for `factors`. Regenerated [`public/openapi.json`](./public/openapi.json) and [`mcp/data/openapi.json`](./mcp/data/openapi.json).

- **Repository layout** — Python SDK source moved from `packages/riskmodels/` to [`sdk/`](./sdk/); local MCP package renamed from `mcp-server/` to [`mcp/`](./mcp/). CI scripts, drift detection, OpenAPI mirror path, and docs updated; Risk_Models sync still reads from `riskmodels_com/mcp-server/data` as the upstream generator output.

- **`GET|PATCH /api/user/billing-config`** — Uses [`authenticateRequest`](./lib/supabase/auth-helper.ts) (API key / JWT / session) with CORS headers for parity with other account routes.

### Added

- **Python SDK (`riskmodels-py` 0.2.1)** — `get_metrics_with_macro_correlation()` (ERM3 metrics + `macro_corr_*` in one row); `as_dataframe=True` on `get_factor_correlation` / `get_factor_correlation_single`; parsing helpers `factor_correlation_body_to_row` / `factor_correlation_batch_item_to_row`; `SHORT_MACRO_CORR_LEGEND` / `COMBINED_ERM3_MACRO_LEGEND`; `to_llm_context` handles raw correlation dicts. See [`sdk/README.md`](./sdk/README.md).

- **MCP JSON Schema — `POST /correlation` request** — [`mcp/data/schemas/factor-correlation-request-v1.json`](./mcp/data/schemas/factor-correlation-request-v1.json) (`$id` `https://riskmodels.app/schemas/factor-correlation-request-v1.json`) for validating request bodies via `riskmodels_get_schema` / schema list. Registered in [`mcp/data/schema-paths.json`](./mcp/data/schema-paths.json). [`factor-correlation-v1.json`](./mcp/data/schemas/factor-correlation-v1.json) documents single-ticker success; batch `results` remains OpenAPI-only. **Risk_Models:** copy the new file and merge `schema-paths.json` entry.

- **OpenAPI parity** — Documented existing routes in [`OPENAPI_SPEC.yaml`](./OPENAPI_SPEC.yaml): `POST /portfolio/risk-index`, `GET|POST|DELETE /webhooks/subscribe`, `PATCH /balance`, `GET|PATCH /user/billing-config`, `GET /rankings/{ticker}`; added Plaid `POST /plaid/link-token` and `POST /plaid/exchange-public-token`; expanded `GET /plaid/holdings` and `POST /chat` response schemas. Regenerates [`public/openapi.json`](./public/openapi.json) and [`mcp/data/openapi.json`](./mcp/data/openapi.json) via `npm run build:openapi`.

- **`GET /api/rankings/{ticker}`** — [`app/api/rankings/[ticker]/route.ts`](./app/api/rankings/[ticker]/route.ts) exposes [`fetchRankingsFromSecurityHistory`](./lib/dal/risk-engine-v3.ts) with optional `metric`, `cohort`, `window` query filters and billing capability `rankings`.

- **`POST /api/chat`** — AI Risk Analyst route ([`app/api/chat/route.ts`](./app/api/chat/route.ts)) using the OpenAI SDK; requires `OPENAI_API_KEY`. Billing uses capability `chat-risk-analyst` with [`getTokenEstimates`](./lib/agent/billing-middleware.ts) for upfront per-token cost estimation.

- **Plaid Investments (API)** — [`app/api/plaid/link-token`](./app/api/plaid/link-token/route.ts), [`exchange-public-token`](./app/api/plaid/exchange-public-token/route.ts), and [`holdings`](./app/api/plaid/holdings/route.ts); AES-256-GCM encryption via [`lib/plaid/token-crypto.ts`](./lib/plaid/token-crypto.ts) (`PLAID_TOKEN_ENCRYPTION_SECRET`). Table `plaid_items` is created and evolved by the migration chain starting at [`supabase/migrations/20251222000000_create_plaid_items_table.sql`](./supabase/migrations/20251222000000_create_plaid_items_table.sql) (including token and uniqueness follow-ons through `20260330120001_plaid_items_user_id_item_id_unique.sql`). Env: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` | `development` | `production`), optional `PLAID_CLIENT_DISPLAY_NAME`. Holdings billing capability `plaid-holdings` (`mcp/data/capabilities.json` updated).

- **Macro factor correlation** — Supabase table [`macro_factors`](./supabase/migrations/20260327120000_macro_factors.sql) (daily `factor_key` + `teo` + `return_gross`), on-demand math in [`lib/risk/factor-correlation-service.ts`](./lib/risk/factor-correlation-service.ts), [`POST /api/correlation`](./app/api/correlation/route.ts), [`GET /api/metrics/{ticker}/correlation`](./app/api/metrics/[ticker]/correlation/route.ts), capability `factor-correlation`, OpenAPI + [`mcp/data/schemas/factor-correlation-v1.json`](./mcp/data/schemas/factor-correlation-v1.json), and SDK `get_factor_correlation`. Stock series support `gross` and ERM3 replication residuals (L1/L2/L3) vs SPY and sector/subsector ETFs; macro series are cached in Redis. Populate `macro_factors` via your ingest job before correlations are non-null.

- **Webhooks** — `webhook_subscriptions` table (see [`supabase/migrations/20250326120000_webhook_subscriptions.sql`](./supabase/migrations/20250326120000_webhook_subscriptions.sql)), [`POST|GET|DELETE /api/webhooks/subscribe`](./app/api/webhooks/subscribe/route.ts), HMAC-signed outbound delivery in [`lib/api/webhooks.ts`](./lib/api/webhooks.ts), and `batch.completed` notifications after [`POST /api/batch/analyze`](./app/api/batch/analyze/route.ts). Maintainer-only doc: `internal/WEBHOOKS_GUIDE.md` (gitignored; see [`internal/README.md`](./internal/README.md)).

### Changed

- **Docs & portal copy (API / MCP / CLI)** — Aligned marketing and guides with shipped behavior: local [`mcp/`](mcp/) exposes only `riskmodels_list_endpoints`, `riskmodels_get_capability`, and `riskmodels_get_schema`; portfolio and decomposition flows are REST/SDK. MCP discovery URL documented as `https://riskmodels.app/.well-known/mcp.json` (with OpenAPI). Quickstart CLI step, [`content/docs/agent-integration.mdx`](content/docs/agent-integration.mdx), [`SKILL.md`](SKILL.md), [`AgenticSection`](components/AgenticSection.tsx), and [`TerminalShowcase`](components/TerminalShowcase.tsx) updated; [`AUTHENTICATION_GUIDE.md`](AUTHENTICATION_GUIDE.md) and [`MIGRATION_V3.md`](MIGRATION_V3.md) MCP tool tables corrected.

- **MCP data sync** — Ran `sync-mcp-from-risk-models.sh`; `mcp/data/capabilities.json`, `schema-paths.json`, and `schemas/*.json` mirrored from Risk_Models `riskmodels_com` generator output.

### Added

- **Python SDK (`sdk`)** — `riskmodels-py` on PyPI layout: `RiskModelsClient` (Bearer + OAuth2 client credentials, optional `httpx` injection for tests), batch portfolio weighted hedge ratios, Parquet/CSV tabular paths, optional `[xarray]` `get_dataset`, agent helpers (`discover` Markdown/JSON, `to_llm_context`, attrs + ERM3 legend, ticker alias map e.g. GOOGL→GOOG, `validate=warn|error|off`). See [sdk/README.md](sdk/README.md).

- **Agentic API landing page integration** — Homepage now features agentic-first messaging with new sections:
  - `AgenticSection` component with "Stop Querying. Start Delegating." value proposition
  - `UseCases` component highlighting four agentic patterns (Pre-Trade Risk Check, Drift Monitoring, Hedge Recommendations, Rebalance Triggers)
  - `ComparisonTable` component with competitive pricing vs MSCI Barra and Northfield
  - Updated `Hero` with "First Agentic Risk API" badge and new headline
  - Quickstart page now includes Agentic API examples (Python/TypeScript)
  - Cross-linking between traditional REST API and agentic delegation workflows

- **`GET /api/health` T coverage** — Response includes `teo_coverage` (`latest_teo`, `latest_teo_coverage_pct`, `non_null_returns_symbol_count`, `universe_stock_count`, `eodhd_latest_session_pending`) derived from `security_history` `returns_gross` vs `symbols` (stocks), using the same 10% sparse threshold as ERM3 EODHD T coverage. `health-v1.json` schema updated; copy synced to Risk_Models.

### Changed

- **OpenAPI tabular exports** — Finalized Parquet/CSV documentation: `application/vnd.apache.parquet` (matches runtime `Content-Type`), shared `FormatQueryTabular` parameter, row schemas `GrossReturnDailyRow` and `BatchAnalyzeExportRow`, `TickerReturnsDailyRow.price_close`, batch export semantics (returns-only long table), CSV examples, and `build:openapi` now mirrors `mcp/data/openapi.json`.

## [0.2.0] — 2026-03-24

### Added

- **Developer portal** — Global search over documentation and primary routes (Fuse.js, ⌘K / Ctrl+K). Persistent **Live Demo** control in the top bar that opens a panel with the public demo API key (when `NEXT_PUBLIC_DEMO_API_KEY` is set), one-click copy, and a link to Quickstart; without the env var, Live Demo links to Quickstart. Navbar uses backdrop blur, subtle shadow, gradient primary CTA, and active-route highlighting for clearer hierarchy.

### Changed

- **`riskmodels-py` 0.2.0** (package `sdk`) — Published on PyPI: [pypi.org/project/riskmodels-py](https://pypi.org/project/riskmodels-py/) (`pip install riskmodels-py==0.2.0`). Version and `__version__` bumped from 0.1.0. **`RiskModelsClient.analyze`** is a documented alias for **`analyze_portfolio`**. **`get_dataset`** (aliases **`get_cube`**, **`get_panel`**) returns an **`xarray.Dataset`** from batch Parquet/CSV long tables when the **`[xarray]`** extra is installed. PyPI trove classifier **Development Status :: 4 - Beta** (was Alpha).

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
