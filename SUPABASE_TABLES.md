# Supabase Tables (RiskModels Backend)

Quick reference for Supabase tables used by the RiskModels API and platform. For authentication and direct DB access (Mode 2 / Mode 3), see [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md).

**Source of truth:** The [Risk_Models](https://github.com/BlueWaterCorp/Risk_Models) repo defines and migrates these tables. Full V3 contract: `docs/supabase/V3_DATA_CONTRACT.md` in that repo.

---

## V3 Schema (Current)

The ERM3 2026 data model uses a normalized identity registry, long-form temporal engine, and pipeline-maintained performance surfaces.

### Core tables

| Table | Purpose |
|-------|---------|
| **`symbols`** | Identity registry: symbol, ticker, name, asset_type, sector_etf, is_adr, isin |
| ~~**`security_history`**~~ | **REMOVED — Pure Zarr for all history.** As of the pure-Zarr SSOT cutover, all historical time series are served exclusively from Zarr via `lib/dal/zarr-reader.ts`: daily metrics from `ds_daily.zarr`, hedge weights from `ds_erm3_hedge_weights_*.zarr`, returns decomposition from `ds_erm3_returns_*.zarr`, rankings from `ds_rankings_*.zarr`. The wide latest row still lives in `security_history_latest` below. |
| **`erm3_sync_state_v3`** | Sync health: `table_name`, `market_factor_etf`, `universe`, `max_date`, `last_synced_at`. |

### Performance surfaces (pipeline-maintained)

| Table | Purpose |
|-------|---------|
| **`erm3_landing_chart_cache`** | Landing page chart: pre-computed cumulative returns (ticker, date, cum_stock, cum_market, cum_sector, cum_subsector). Last 3 years. |
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
| `stock_var` | Stock-specific variance | `ds_erm3_hedge_weights_*.zarr` |
| `rank_ord_{window}_{cohort}_{metric}`, `cohort_size_{window}_{cohort}_{metric}` | Cross-sectional rankings | `ds_rankings_*.zarr` |

### security_history_latest schema

| Column | Type | Description |
|--------|------|-------------|
| `symbol` | TEXT | FK to symbols.symbol |
| `periodicity` | TEXT | `daily` or `monthly` |
| `teo` | DATE | Latest complete trading date |
| `returns_gross`, `vol_23d` | FLOAT8 | Latest core metrics |
| `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | FLOAT8 | Latest L3 hedge ratios |
| `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` | FLOAT8 | Latest L3 explainability |
| `l1_cfr`, `l1_fr`, `l1_rr`, `l2_cfr`, `l2_fr`, `l2_rr`, `l3_cfr`, `l3_fr`, `l3_rr` | FLOAT8 | Latest returns-decomposition daily simple returns. `*_cfr` is cumulative-through-level (market → market+sector → full); `*_fr` is incremental (per-level contribution on top of the prior levels); `*_rr` is the residual at each level. |
| `l1_mkt_beta`, `l2_sec_beta`, `l3_sub_beta` | FLOAT8 | Latest hierarchical regression betas. `l1_mkt_beta` is beta to SPY (always). `l2_sec_beta` is beta to the symbol's sector ETF (e.g. XLK for AAPL). `l3_sub_beta` is beta to the symbol's subsector ETF (e.g. RSPT for AAPL). One value per level — see `OPENAPI_SPEC.yaml` `MetricsV3` schema for the property definitions. NOT the same as hedge ratios (`*_hr`), which are dollar-notional ratios; betas here are dimensionless regression coefficients. |
| `updated_at` | TIMESTAMPTZ | When row was last refreshed |

**Primary key:** `(symbol, periodicity)`.

---

## Billing & agents

| Table | Purpose |
|-------|---------|
| `agent_accounts`, `agent_api_keys` | Agent keys and provisioning |
| `billing_events`, `agent_invoices`, `balance_top_ups` | Billing and prepaid balance |
| `user_generated_api_keys` | User-generated API keys (dashboard) |

---

## Internal

| Table | Purpose |
|-------|---------|
| `ticker_request_logs` | Request logging / analytics |

---

## Legacy tables (deprecated)

The following tables were used prior to V3 and may still exist for backward compatibility. New integrations should use the V3 schema above.

| Table | Superseded by |
|-------|---------------|
| `ticker_metadata` | `symbols` |
| `ticker_factor_metrics` | `security_history_latest` |
| `erm3_ticker_returns`, `erm3_l3_decomposition` | `security_history` |
| `erm3_time_index` | `trading_calendar` |

---

When Risk_Models adds or renames tables, update this file and the table list in [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md). The sync script `sync-mcp-from-risk-models.sh` reminds maintainers to keep these docs in sync.
