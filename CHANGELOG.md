# Changelog

All notable changes to the RiskModels API surface and public assets.

## [Unreleased]

### Added

- **V3 returns decomposition** — New optional metrics `l1_cfr`, `l1_rr`, `l2_cfr`, `l2_rr`, `l3_cfr`, `l3_rr` in `security_history` (from `ds_erm3_returns`) and optional `security_history_latest` wide columns via idempotent migration; sync state key `security_history_returns_decomp` on `erm3_sync_state_v3`. Wired through DAL, `GET /metrics/{ticker}`, data-plane `L123_METRIC_KEYS` backfill, OpenAPI `MetricsV3`, Python SDK `METRICS_V3_TO_SEMANTIC` + hints, [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md), [SUPABASE_TABLES.md](SUPABASE_TABLES.md), portal [returns-decomposition-metrics](content/docs/returns-decomposition-metrics.mdx), and [README_API.md](README_API.md) (ERM3 `--returns-decomp-tickers` / `run_sync` pointer). Regenerated `public/openapi.json` and `mcp/data/openapi.json`.

### Changed

- **Vendor-neutral health + SDK paths** — `GET /api/health` `teo_coverage` renames the sparse latest-session boolean to `latest_session_returns_pending` and drops vendor naming from OpenAPI/schema copy. Python zarr helpers centralize default ERM3 stock pipeline paths in `zarr_context` (`default_erm3_zarr_path()`, optional `ERM3_STOCK_PIPELINE_DIR` / `ERM3_SECURITY_MASTER_DB`); bulk/mag7 scripts reuse that resolver. Legacy default directory/SQLite filenames remain configurable for existing ERM3 trees.

- **Documentation precision** — [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md) adds a short **hedge ratios vs classical betas** note (L2/L3 hierarchy, `dollar_ratio`). [OPENAPI_SPEC.yaml](OPENAPI_SPEC.yaml) `info.description` now describes Supabase **V3** tables (`security_history`, `security_history_latest`, `symbols`, supporting surfaces) and rankings from `security_history` metric keys (not legacy `erm3_betas` / `erm3_rankings`). [SUPABASE_TABLES.md](SUPABASE_TABLES.md) metric_key row no longer equates HR with betas without qualification. [README_API.md](README_API.md) endpoint table matches behavior (`/api/ticker-returns` is L3 HR/ER in the time series; `/api/metrics/{ticker}` omits Sharpe), and documents the `/api/data/*` data plane vs OpenAPI. [docs/SNAPSHOT_CONTENT_MAP.md](docs/SNAPSHOT_CONTENT_MAP.md) uses HR wording consistently. Regenerated `public/openapi.json` and `mcp/data/openapi.json` from the spec.

- **Portal & email copy** — Landing/pricing alignment: [components/UseCases.tsx](components/UseCases.tsx), [components/AgenticSection.tsx](components/AgenticSection.tsx), [components/TerminalShowcase.tsx](components/TerminalShowcase.tsx), [app/pricing/page.tsx](app/pricing/page.tsx), [emails/low-balance.tsx](emails/low-balance.tsx), [lib/chat/system-prompt.ts](lib/chat/system-prompt.ts). [README_API.md](README_API.md) quickstart examples use the nested `metrics` object and wire HR/ER keys. Removes incorrect **Sharpe** claim from the low-balance email; clarifies **L3** vs full snapshot on ticker returns.

- **OpenAPI MCP tool copy** — `analyze_portfolio` description no longer claims **Sharpe** (not returned by batch/metrics routes). Regenerated JSON; mirrored to **Risk_Models** `riskmodels_com/mcp-server/data/openapi.json`.

## [0.3.0] — 2026-04-07

### Added

- **Python SDK (`riskmodels-py` 0.3.0)** — 3D-style namespaces on `RiskModelsClient` (`.stock`, `.portfolio`, `.pri`, `.insights`) with `.current` / `.historical` facades; `PerformanceResult` for tabular + `.plot()` dispatch; `riskmodels.visuals` (Plotly) for L3 horizontal decomposition and portfolio risk/attribution cascades; optional **`pip install riskmodels-py[viz]`** (plotly, matplotlib, seaborn, kaleido); PDF transport helpers `get_metrics_snapshot_pdf` / `post_portfolio_risk_snapshot_pdf`; `positions_to_weights` accepts `{"ticker","weight"}` lists. See `sdk/README.md` and `sdk/pyproject.toml`.

- **Docs** — `docs/CHAT_MANUAL_QA.md` §8: manual QA checklist for the **Risk_Models** portal (`/chat` proxy, anonymous vs JWT, tier caps, streaming note).

- **POST /api/chat agentic tools** — OpenAI function calling with eight internal tools (DAL-backed): metrics snapshot, L3 decomposition, ticker returns, rankings, factor correlation, macro factors, free ticker search, portfolio risk index. Per-tool billing via `deductBalance`; response includes `tool_calls_summary` and `_agent.llm_cost_usd` / `tool_cost_usd` / `tool_calls`. New modules under `lib/chat/`; `lib/dal/ticker-search.ts` shared with `GET /api/tickers?search=`. Cost preflight: `POST /api/estimate` with `endpoint: "chat"` returns `available_tools` and an LLM-only token estimate.

- **Transactional email (developer portal)** — **`lib/email-service.ts`** sends via **Resend** + **React Email** (templates under **`emails/`**, aligned with Risk_Models). **`RESEND_API_KEY`** required; **`RESEND_FROM_EMAIL`** / **`RESEND_BCC_EMAIL`** optional (audit BCC defaults to **`resend@riskmodels.app`** per **`lib/resend-audit.ts`**). Low-balance alerts from **`lib/agent/billing.ts`** log to **`email_logs`** when **`userId`** is provided. Vercel allowlist updated in **`scripts/doppler-vercel-allowlist.txt`**.

- **Portfolio risk snapshot (Phase 7)** — **`POST /api/portfolio/risk-snapshot`** returns structured JSON or a one-page PDF (`format=pdf`); capability **`portfolio-risk-snapshot`** ($0.25, **`risk_snapshot_pdf_v1`**). **`GET /api/metrics/{ticker}/snapshot.pdf`** reuses the same capability for a single-name PDF. Responses are cached ~24h per user (Redis or in-memory); cache hits bill **`$0`** and set **`X-Cache: HIT`**. PNG export returns **501** until implemented. Shared computation lives in **`lib/portfolio/portfolio-risk-core.ts`**; PDF layout in **`lib/portfolio/risk-snapshot-pdf.ts`** (**`pdf-lib`**).

- **OpenAPI `x-pricing`** — Metered operations in **`OPENAPI_SPEC.yaml`** include `x-pricing` (`capability_id`, `tier`, `model`, `cost_usd`, `billing_code`, optional `min_charge` / per-token fields) aligned with **`lib/agent/capabilities.ts`**. Documented public **`GET /pricing`** in the spec (matches **`app/api/pricing/route.ts`**).

- **`GET /api/macro-factors`** — Read-only long-format daily macro factor returns from `macro_factors` (`factor_key`, `teo`, `return_gross`) with optional `start` / `end` / `factors`; capability **`macro-factor-series`**, OAuth scope **`macro-factor-series`**, JSON Schema **`mcp/data/schemas/macro-factors-series-v1.json`**. Python SDK **`get_macro_factor_series`**, CLI **`riskmodels macro-factors`**, portal doc **`content/docs/macro-factors.mdx`**.

- **CI** — Root **`npm test`** (Vitest) covers **`FactorCorrelationRequestSchema`** and **`parseMacroFactorsSeriesQuery`**.

- **Public Python SDK hints** — `GET /api/sdk/python` returns JSON (`package`, `min_version`, `upgrade_message`, `docs_url`) for notebooks and CLIs; no auth. Override copy with `RISKMODELS_PY_UPGRADE_MESSAGE` and minimum version with `RISKMODELS_PY_MIN_VERSION` (see `app/api/sdk/python/route.ts`).

- **Python SDK** — `format_metrics_snapshot(row)` for human-readable L3 metrics text from a `get_metrics` dict row; `examples/quickstart.py` CLI demo. See [packages/riskmodels/README.md](packages/riskmodels/README.md).

### Changed

- **Premium endpoint pricing (Phase 2)** — Raised `cost_usd` and bumped `billing_code` versions for: `risk-decomposition` / `l3-decomposition` ($0.02), `portfolio-risk-index` ($0.03), `batch-analysis` ($0.005/position, min $0.01), `portfolio-returns` ($0.004/position, min $0.01), `plaid-holdings` ($0.02). See `PREMIUM_TIER_DESIGN.md`. `OPENAPI_SPEC.yaml` billing copy and `mcp/data/capabilities.json` aligned with `lib/agent/capabilities.ts`.

- **`GET /api/sdk/python`** — Default `min_version` and bundled `upgrade_message` now target **`riskmodels-py` ≥ 0.3.0** and the editable path **`RiskModels_API/sdk`** (aligned with `sdk/pyproject.toml`).

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

- **`GET /api/health` T coverage** — Response includes `teo_coverage` (`latest_teo`, `latest_teo_coverage_pct`, `non_null_returns_symbol_count`, `universe_stock_count`, plus a boolean for sparse latest-session gross returns) derived from `security_history` `returns_gross` vs `symbols` (stocks), using a 10% sparse threshold. `health-v1.json` schema updated; copy synced to Risk_Models.

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
