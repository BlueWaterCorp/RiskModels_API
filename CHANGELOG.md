# Changelog

All notable changes to the RiskModels API surface and public assets.

## [Unreleased]

### Added

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
