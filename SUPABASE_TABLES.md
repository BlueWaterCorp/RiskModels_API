# Supabase Tables (RiskModels Backend)

Quick reference for Supabase tables used by the RiskModels API and platform. For authentication and direct DB access (Mode 2 / Mode 3), see [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md).

**Source of truth:** The [Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models) repo defines and migrates these tables. Full V3 contract: `docs/supabase/V3_DATA_CONTRACT.md` in that repo.

---

## V3 Schema (Current)

The ERM3 2026 data model uses a normalized identity registry, long-form temporal engine, and pipeline-maintained performance surfaces.

### Core tables

| Table | Purpose |
|-------|---------|
| **`symbols`** | Identity registry: symbol, ticker, name, asset_type, sector_etf, is_adr, isin |
| **`security_history`** | Long-form temporal engine: one row per (symbol, teo, periodicity, metric_key). Stores returns, vol, L1/L2/L3 hedge ratios, explainability ratios. |
| **`erm3_sync_state_v3`** | Sync health: table_name, market_factor_etf, universe, max_date, last_synced_at |

### Performance surfaces (pipeline-maintained)

| Table | Purpose |
|-------|---------|
| **`erm3_landing_chart_cache`** | Landing page chart: pre-computed cumulative returns (ticker, date, cum_stock, cum_market, cum_sector, cum_subsector). Last 3 years. |
| **`security_history_latest`** | Latest metrics per symbol/periodicity: returns_gross, vol_23d, L3 HR/ER. Used by cards, tape, treemap. |
| **`trading_calendar`** | Canonical trading dates (teo, periodicity). Replaces mining distinct dates from security_history. |

### security_history metric_key values

| metric_key | Meaning |
|------------|---------|
| `returns_gross` | Simple gross return |
| `vol_23d` | 23-day rolling volatility |
| `price_close`, `market_cap` | Price and market cap |
| `l1_mkt_hr`, `l2_mkt_hr`, `l2_sec_hr`, `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | Hedge ratios / betas |
| `l1_mkt_er`, `l1_res_er`, `l2_mkt_er`, `l2_sec_er`, `l2_res_er`, `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` | Explainability ratios |
| `stock_var` | Stock-specific variance |

### security_history_latest schema

| Column | Type | Description |
|--------|------|-------------|
| `symbol` | TEXT | FK to symbols.symbol |
| `periodicity` | TEXT | `daily` or `monthly` |
| `teo` | DATE | Latest complete trading date |
| `returns_gross`, `vol_23d` | FLOAT8 | Latest core metrics |
| `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr` | FLOAT8 | Latest L3 hedge ratios |
| `l3_mkt_er`, `l3_sec_er`, `l3_sub_er`, `l3_res_er` | FLOAT8 | Latest L3 explainability |
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
