# Supabase Tables (RiskModels Backend)

Quick reference for Supabase tables used by the RiskModels API and platform. For authentication and direct DB access (Mode 2 / Mode 3), see [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md).

**Writers:** the ERM3 nightly sync (`ERM3/scripts/python/lib/supabase_schema_v3.py`) and the Funds_DAG sync; DDL lives in `BWMACRO/supabase/migrations/`.

**Shared SQL migrations:** DDL lives under **`BWMACRO/supabase/migrations/`** (canonical — BWMACRO is private; RiskModels_API is a public repo, so SQL DDL is not committed here). Push to the linked Supabase project from `BWMACRO/supabase/`.

---

## V3 Schema (Current)

The ERM3 2026 data model uses a normalized identity registry, long-form temporal engine, and pipeline-maintained performance surfaces.

### Core tables

| Table | Purpose |
|-------|---------|
| **`symbols`** | Identity registry: symbol, ticker, name, asset_type, sector_etf, is_adr, isin |
| ~~**`security_history`**~~ | **STALE — FROZEN 2026-04-14** (table still exists, ~204M rows; nothing writes it; do not read). **Pure Zarr for all history.** As of the pure-Zarr SSOT cutover, all historical time series are served exclusively from Zarr via `lib/dal/zarr-reader.ts`: daily metrics from `ds_daily.zarr`, hedge weights from `ds_erm3_hedge_weights_*.zarr`, returns decomposition from `ds_erm3_returns_*.zarr`, rankings from `ds_rankings_*.zarr`. The wide latest row still lives in `security_history_latest` below. |
| **`erm3_sync_state_v4`** | Sync health: `table_name`, `max_date`, `last_synced_at`. |

**Closed `symbols` rows.** The ERM3 sync never deletes a `symbols` row for a closed identity. It marks the row closed instead: `metadata.is_delisted = true`, written from the security master each night for every row, including rows whose id is no longer on the published `ds_daily` axis. A closed row also takes the master's `unique_ticker` when that differs from its ticker (`LGTY#1`, `KEEL#2`), so a recycled ticker stays free for the live holder. Only the post-sync trim deletes rows (stocks out of the mask for more than a year). `sector_etf` / `subsector_etf` on rows off the axis are refreshed from the security master mirror (ERM3 board n012).

Ticker resolution (`resolveSymbolByTicker` / `resolveSymbolsByTickers` in `lib/dal/risk-engine-v3.ts`) reads `metadata.is_delisted === true` as closed (`isDeadSymbolRow`). A missing key or `false` counts as live. When several rows share a ticker, a live row is picked before a closed one, and then the lowest `symbol` (`pickLiveRow`). A closed direct row never answers as live. Resolution goes on to the alias mirror and then to the most-recent-holder pass: a servable live holder of the ticker in `security_master` replaces it, and otherwise the closed row stays the answer (`delisted` true in the holder pass).

### Identity (live, nightly)

| Table | Purpose |
|-------|---------|
| **`security_master`** | Mirror of the ERM3 security master (35,856 rows on 2026-11-09): `company_name`, `subsector_etfs`. |
| **`security_aliases`** | Ticker / alias → symbol history; ticker-change resolution (e.g. FB→META). |
| **`security_events`**, **`security_event_legs`** | Corporate identity events and their legs. |
| **`security_name_history`** | Point-in-time company names. |
| **`security_listing`** | Listings per security. |
| **`security_company_map`** | Security → company map. |
| **`class_projections_current`** | Current share-class projections. |

### Zarr stores (`gs://rm_api_data/eodhd/`)

All history is read from these stores via `lib/dal/zarr-reader.ts`: `ds_daily` (prices, returns, `bw_sector_id`, `bw_industry_id`), `ds_erm3_cohorts_*`, `ds_market_cap`, `ds_masks`, `ds_erm3_hedge_weights_*`, `ds_erm3_returns_*`, `ds_rankings_*`.

### Performance surfaces (pipeline-maintained)

| Table | Purpose |
|-------|---------|
| ~~**`erm3_landing_chart_cache`**~~ | **STALE — EMPTY (0 rows) since 2026-04**; route `/api/data/landing-cache` has no callers. Do not use. Returns history: `ds_erm3_returns_*.zarr`. |
| **`security_history_latest`** | Latest metrics per symbol/periodicity: returns_gross, vol_23d, L1/L2/L3 HR/ER, optional `l1_cfr`…`l3_rr` when present. Used by cards, tape, treemap. |
| **`trading_calendar`** | Canonical trading dates (teo, periodicity). The authoritative time index for the API. |
| **`macro_factors`** | Daily macro factor total returns: one row per (`factor_key`, `teo`) with `return_gross` and optional `metadata` jsonb. Ten canonical `factor_key` values: `inflation`, `term_spread`, `short_rates`, `credit`, `oil`, `gold`, `usd`, `volatility` (VXX futures-based), `bitcoin`, `vix_spot` (FRED VIXCLS spot). Legacy v1 names (`dxy`, `vix`, `ust10y2y`) are accepted as aliases for historical rows. See [`lib/risk/macro-factor-keys.ts`](lib/risk/macro-factor-keys.ts) and [`erm3/shared/macro_factor_constants.py`](erm3/shared/macro_factor_constants.py) (Python canonical source). Used by `POST /api/correlation`, `GET /api/metrics/{ticker}/correlation`, and `GET /api/macro-factors`. |

### Historical metric_key values (now served from Zarr)

The metric keys below are the same ones the API exposes in range-history responses; their values now come from the consolidated Zarr stores on GCS rather than from the removed `security_history` table. See `lib/dal/zarr-metric-registry.ts` for the exact variable mapping.

| metric_key | Meaning | Zarr store |
|------------|---------|------------|
| `returns_gross` | Simple gross return | `ds_daily.zarr` |
| `vol_23d` | 23-day rolling volatility (`sqrt(stock_var * 252)`) | `ds_erm3_hedge_weights_*.zarr` |
| `price_close`, `market_cap` | Price and market cap | `ds_daily.zarr` |
| `l1_mkt_hr`, `l2_mkt_hr`, `l2_sec_hr`, `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | Hedge ratios (dollar notionals per $1 stock; NOT classical betas — see [SEMANTIC_ALIASES.md](SEMANTIC_ALIASES.md)). | `ds_erm3_hedge_weights_*.zarr` |
| `l1_mkt_er`, `l1_res_er`, `l2_mkt_er`, `l2_sec_er`, `l2_res_er`, `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` | Explainability ratios (variance fractions) | `ds_erm3_hedge_weights_*.zarr` |
| `l1_cfr`, `l2_cfr`, `l3_cfr` | **Combined** (cumulative-through-level) factor return. `l1_cfr=l1_fr`, `l2_cfr=l1_fr+l2_fr`, `l3_cfr=l1_fr+l2_fr+l3_fr`. | `ds_erm3_returns_*.zarr` `combined_factor_return` |
| `l1_fr`, `l2_fr`, `l3_fr` | **Incremental** per-level factor return. `l2_fr` is the sector factor's contribution on top of L1; `l3_fr` is the subsector factor on top of L1+L2. Use for stacked-bar decomposition and per-level attribution. | `ds_erm3_returns_*.zarr` `factor_return` |
| `l1_rr`, `l2_rr`, `l3_rr` | Residual return at each level. `gross_return ≈ l3_cfr + l3_rr`. | `ds_erm3_returns_*.zarr` `residual_return` |
| `stock_var` | Total daily return variance, 252-day rolling window (ERM3 `_stock_var`; residual variance = `stock_var × l3_res_er`) | `ds_erm3_hedge_weights_*.zarr` |
| `rank_ord_{window}_{cohort}_{metric}`, `cohort_size_{window}_{cohort}_{metric}` | Cross-sectional rankings | `ds_rankings_*.zarr` |

### security_history_latest schema

| Column | Type | Description |
|--------|------|-------------|
| `symbol` | TEXT | FK to symbols.symbol |
| `periodicity` | TEXT | `daily` (monthly rows not currently populated) |
| `teo` | DATE | Latest complete trading date |
| `returns_gross`, `vol_23d` | FLOAT8 | Latest core metrics |
| `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | FLOAT8 | Latest L3 hedge ratios |
| `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` | FLOAT8 | Latest L3 explainability |
| `l1_cfr`, `l1_fr`, `l1_rr`, `l2_cfr`, `l2_fr`, `l2_rr`, `l3_cfr`, `l3_fr`, `l3_rr` | FLOAT8 | Latest returns-decomposition daily simple returns. `*_cfr` is cumulative-through-level (market → market+sector → full); `*_fr` is incremental (per-level contribution on top of the prior levels); `*_rr` is the residual at each level. |
| `l1_mkt_beta`, `l2_sec_beta`, `l3_sub_beta` | FLOAT8 | Latest hierarchical regression betas. `l1_mkt_beta` is beta to SPY (always). `l2_sec_beta` is beta to the symbol's sector ETF (e.g. XLK for AAPL). `l3_sub_beta` is beta to the symbol's subsector ETF (e.g. RSPT for AAPL). One value per level — see `OPENAPI_SPEC.yaml` `MetricsV3` schema for the property definitions. NOT the same as hedge ratios (`*_hr`), which are dollar-notional ratios; betas here are dimensionless regression coefficients. |
| `data_quality_flags` | JSONB, nullable | ERM3 gate-policy carry state for an id the nightly build holds: `{"carried_forward": bool, "carried_sessions": int, "carry_expired": bool}`. `carried_forward`: the row is the last published one, kept while the id is held. `carried_sessions`: NYSE sessions since the last observed published close. `carry_expired`: the id is past its carry limit (`gates.carry.max_carry_sessions` in ERM3 `config.yaml`) and every metric on the row is null for the session. NULL for ids that are not held. Written by ERM3 `scripts/python/lib/supabase_schema_v3.py`. Migration: `BWMACRO/supabase/migrations/20261109120000_security_history_latest_data_quality_flags.sql` (pending; until applied the writer sends no flags). |
| `updated_at` | TIMESTAMPTZ | When row was last refreshed |

**Primary key:** `(symbol, periodicity)`.

---

## Billing & agents

| Table | Purpose |
|-------|---------|
| `agent_accounts`, `agent_api_keys` | Agent keys and provisioning |
| `billing_events`, `agent_invoices`, `balance_top_ups` | Billing and prepaid balance |
| `user_generated_api_keys` | User-generated API keys (dashboard) |
| `user_email_preferences` | J.12 digest: per-user watch tickers (max 5), fund company slugs (max 2), `frequency`, `last_digest_sent_at`. RLS: users own row; cron uses service role. |

`agent_accounts.signup_attribution` (jsonb, nullable): first-touch UTM + landing metadata (`utm_*`, `landing_path`, `referrer`, `timestamp`); written once on first `rm_agent_*` key creation from `/get-key` when the client sends validated `utm` in `POST /api/agent-keys`. Migration: `20260524120000_add_agent_accounts_signup_attribution.sql`.

`agent_accounts.billing_mode` (`prepaid` default | `licensed`) and `license_tier` (`desk` | `firm` | `production`, null on prepaid): institutional keys skip prepaid deduct/402; usage is `billing_events` `type=telemetry` with `metadata.list_price_usd`. Views: `licensed_usage_daily`, `licensed_usage_totals`, `licensed_usage_tickers_daily`. Migration: `BWMACRO/supabase/migrations/20260816010000_agent_accounts_licensed_billing.sql`. Admin: `/admin/licensed-usage`.

---

## Internal

| Table | Purpose |
|-------|---------|
| `ticker_request_logs` | Request logging / analytics |
| `feed_waitlist` | Early-access signups for the security master change feed (`/security-master-feed`, `POST /api/feed-waitlist`). One row per lowercased email; optional `user_id` when signed in. Double opt-in: `consent_feed_emails` is set only when the address owner confirms (`POST /api/feed-waitlist/confirm`, token stored as sha256 in `confirm_token_hash`, expiring at `confirm_expires_at`); the signup route never sets it. `feed_waitlist_claim_confirmation()` atomically throttles confirmation emails (`confirm_sent_at`, `confirm_send_count`: 15 minutes apart, at most 3 per rolling 24 hours, restarting once the last send is older than the window). `consent_confirmed_at` is required whenever `consent_feed_emails` is true (CHECK constraint). Two addresses: `email` is the contact (relationship email); an optional separate delivery address (`requested_feed_email` on a new contact row, `purpose='feed'` row, link table `feed_waitlist_delivery`) receives editions and confirms for itself. `feed_waitlist_confirm()` records consent and creates the link only after the contact confirms, and only to a `purpose='feed'` row (an address that already belongs to a contact is never linked as someone's delivery address); `feed_waitlist_claim_confirmation()` returns the stored `requested_feed_email` so the confirmation email always names the address confirming acts on; `feed_waitlist_edition_recipients()` resolves who gets an edition and checks purpose on both sides of every link. All four feed_waitlist functions are SECURITY DEFINER, search_path pinned, service role only. Personal invitations (`invited_by`, `invited_at`, `invite_claimed_at`, `invite_claim_id`, `feed_waitlist_claim_invite()`) are exactly-once; release and mark match the run's claim id. `unsubscribe_token` (uuid) is carried in every feed email's unsubscribe link and `List-Unsubscribe` header; `unsubscribed_at` is set by `POST /api/feed-waitlist/unsubscribe`, and senders skip those rows. RLS on, no client policies; service role only. Migrations: `BWMACRO/supabase/migrations/20261102120000_feed_waitlist.sql`, `20261102190000_feed_waitlist_double_optin.sql`, `20261102200000_feed_waitlist_delivery_addresses.sql`. |

---

## Legacy tables (deprecated)

The following tables were used prior to V3 and may still exist for backward compatibility. New integrations should use the V3 schema above.

| Table | Superseded by |
|-------|---------------|
| `ticker_metadata` | `symbols` / `security_master` — STALE: frozen 2026-01-21; still read by SDK PeerGroupProxy and the ERM3 name overlay until migrated (PRs #500/#506). Do not use. |
| `etf_metadata` | `ds_etf.zarr`, `lib/dal/etf-register.ts` — STALE: frozen 2026-03-28, nothing reads it. |
| `ticker_change_history` (1 row), `ticker_history` (0 rows) | `security_aliases`, `security_events`, `security_name_history` — STALE, do not use. |
| `erm3_landing_chart_cache_old` | `ds_erm3_returns_*.zarr` — STALE (to 2026-04-08). |
| `erm3_mag7_yearly_contributions` | — STALE: empty (0 rows). |
| `ticker_factor_metrics` | `security_history_latest` |
| `erm3_ticker_returns`, `erm3_l3_decomposition` | Zarr (`ds_erm3_returns_*`) |
| `erm3_time_index` | `trading_calendar` |

---

When the ERM3 sync or a BWMACRO migration adds or renames tables, update this file and the table list in [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md). The sync script `sync-mcp-from-risk-models.sh` reminds maintainers to keep these docs in sync.
