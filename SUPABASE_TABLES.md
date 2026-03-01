# Supabase Tables (RiskModels Backend)

Quick reference for Supabase tables used by the RiskModels API and platform. For authentication and direct DB access (Mode 2 / Mode 3), see [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md).

**Source of truth:** The [Risk_Models](https://github.com/Cerebellum-Archive/Risk_Models) repo defines and migrates these tables. This doc is kept in sync for API and CLI consumers.

---

## API & risk data

| Table | Purpose |
|-------|---------|
| `ticker_factor_metrics` | Latest risk metrics per ticker (HR/ER, vol, sector); RLS for paid access |
| `ticker_factor_metrics_free` | View for free-tier subset |
| `ticker_metadata` | Ticker symbols, names, sector/ETF mappings |
| `erm3_ticker_returns` | Per-ticker return series (ticker, date) |
| `erm3_l3_decomposition` | L1/L2/L3 hedge and explained-risk history (e.g. monthly) |
| `erm3_time_index` | Trading date grid |
| `erm3_etf_returns` | ETF return series |
| **`erm3_betas`** | Factor betas per ticker/date/fact with level; synced from ERM3/Zarr. See schema below. |
| **`erm3_rankings`** | Ticker rankings (e.g. risk, factor exposure) for screening and API |

### erm3_betas schema (L* level-aware)

| Column | Type | Description |
|--------|------|-------------|
| `market_factor_etf` | TEXT | e.g. SPY |
| `universe` | TEXT | e.g. uni_mc_3000 |
| `ticker` | TEXT | Stock ticker |
| `date` | DATE | Month-beginning (first trading day of month) |
| `fact` | TEXT | Factor ETF (SPY, XLE, XLK, …) |
| **`fact_level`** | SMALLINT | Regression level: 1 = market, 2 = sector, 3 = subsector |
| **`level_label`** | TEXT | L* label: `l1_market`, `l2_sector`, `l3_subsector` |
| `beta` | FLOAT4 | Factor beta |
| `created_at`, `updated_at` | TIMESTAMPTZ | Audit |

**Unique key:** `(market_factor_etf, universe, ticker, date, fact, fact_level)`. Upserts and sync use this for conflict target.

**Index:** `idx_erm3_betas_ticker_date_level` on `(ticker, date DESC, fact_level)` for level-filtered queries. This schema is live in production after the `migrate_erm3_betas_add_fact_level` migration.

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

When Risk_Models adds or renames tables, update this file and the table list in [AUTHENTICATION_GUIDE.md](AUTHENTICATION_GUIDE.md). The sync script `sync-mcp-from-risk-models.sh` reminds maintainers to keep these docs in sync.
