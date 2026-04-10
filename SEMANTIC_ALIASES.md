# Semantic Aliases — RiskModels API Field Reference

This document defines every field returned by the RiskModels API, including units, formulas, and usage guidance.

---

## Hedge Ratio (HR) Fields

Unit: **`dollar_ratio`** — dollar notional of the factor ETF to trade per $1 of stock position.

To compute hedge notional: `hedge_notional_usd = position_size_usd × hr_field`

| Field | Description | Typical Range |
|---|---|---|
| `l1_market_hr` | SPY ratio for the L1 (market-only) hedge — 1 trade required | 0.4 – 1.5 |
| `l2_market_hr` | SPY component of the L2 (market + sector) hedge | 0.3 – 1.2 |
| `l2_sector_hr` | Sector ETF component of the L2 hedge | 0.1 – 0.6 |
| `l3_market_hr` | SPY component of the L3 (full, three-ETF) hedge | 0.2 – 1.1 |
| `l3_sector_hr` | Sector ETF component of the L3 hedge | 0.1 – 0.5 |
| `l3_subsector_hr` | Subsector ETF component of the L3 hedge | -0.3 – 0.4 |

### Sign convention (hedge ratios)

- **Any HR field may be negative** (orthogonalization / factor neutralization, or a long ETF leg when the economic hedge is expressed that way). A negative value is not automatically a data or sign error.
- **Most often**, negative HRs show up on the **market factor** (`l2_market_hr`, `l3_market_hr`) at L2 or L3; subsector and other components can also be negative depending on the name and window.

### Hedge Levels

| Level | Trades | ETFs Used | Use Case |
|---|---|---|---|
| **L1** | 1 | SPY only | Quick market-neutral hedge |
| **L2** | 2 | SPY + sector ETF | Remove market + sector exposure |
| **L3** | 3 | SPY + sector + subsector ETF | Institutional-grade, full factor neutrality |

### Hedge ratios vs classical regression betas

- API **`*_hr` fields are hedge ratios** in **`dollar_ratio`** units (ETF notional per $1 of stock), as in the table above—not dimensionless CAPM-style slopes unless you convert explicitly for a chosen price context.
- At **L2 and L3**, each leg is part of a **hierarchical, ETF-executable hedge**. Those values are **not** guaranteed to match a **univariate OLS beta** of the stock on that ETF alone, because estimation orthogonalizes across levels and uses internal link adjustments.
- For **variance explained** and hierarchical decomposition language, use **`*_er`** (explained risk). For how estimation relates to published hedges, see [ENGINE_METHOD_NOTES.md](ENGINE_METHOD_NOTES.md) §3 (Industry-Level Structure).

---

## Explained Risk (ER) Fields

Unit: **`decimal_fraction`** — fraction of stock variance explained by the factor (0.0 to 1.0). Equivalent to R-squared from the regression.

**Key property:** The four L3 components sum to approximately 1.0:
```
l3_market_er + l3_sector_er + l3_subsector_er + l3_residual_er ≈ 1.0
```

| Field | Description | Typical Range |
|---|---|---|
| `l1_market_er` | Fraction of variance explained by market factor (SPY) at L1 | 0.1 – 0.7 |
| `l2_market_er` | Market component ER at L2 (less than L1 due to sector collinearity) | 0.1 – 0.6 |
| `l2_sector_er` | Sector ETF component ER at L2 | 0.02 – 0.2 |
| `l3_market_er` | Market component ER at L3 | 0.1 – 0.55 |
| `l3_sector_er` | Sector ETF component ER at L3 | 0.02 – 0.18 |
| `l3_subsector_er` | Subsector ETF component ER at L3 | 0.01 – 0.15 |
| `l3_residual_er` | **Idiosyncratic variance fraction** — cannot be removed by ETF hedges | 0.2 – 0.85 |

### Residual Risk (RR) Formula

```
RR = l3_residual_er = 1 - (l3_market_er + l3_sector_er + l3_subsector_er)
```

High RR (> 0.5) indicates a stock with significant idiosyncratic return — useful for alpha-seeking strategies.

### Factor Hierarchy

- **L1**: Market-only regression (SPY)
- **L2**: Market + GICS sector ETF (two-factor)
- **L3**: Market + GICS sector + GICS subsector ETF (three-factor, maximum granularity)

---

## Risk & Return Metrics

| Field | Unit | Description |
|---|---|---|
| `volatility` | `annualized_decimal` | Annualised realised volatility. Multiply by 100 for percentage. Example: `0.32` = 32% annualised vol. |
| `sharpe_ratio` | dimensionless | Annualised Sharpe ratio (excess return / annualised vol) |
| `close_price` | USD | Most recent closing price |
| `market_cap` | USD | Market capitalisation in dollars |

---

## Macro factors (`POST /correlation`, `GET /metrics/{ticker}/correlation`, `GET /macro-factors`)

**POST body (JSON Schema):** `https://riskmodels.app/schemas/factor-correlation-request-v1.json` (also listed in MCP `schema-paths` as `factor-correlation-request-v1.json`). **Single-ticker success body:** `https://riskmodels.app/schemas/factor-correlation-v1.json` (batch responses use a `results` array; see OpenAPI).

**Raw series (no ticker):** `GET /api/macro-factors` returns long-format rows from `macro_factors` for a requested date range. **JSON Schema:** `https://riskmodels.app/schemas/macro-factors-series-v1.json`. Query params: optional comma-separated `factors` (or `factor`), optional `start` / `end` (`YYYY-MM-DD`). Defaults: all six canonical keys, `end` = today (UTC), `start` = five calendar years before `end`; maximum span 20 years.

Daily **macro factor returns** are stored in Supabase `macro_factors` as `return_gross` per `factor_key` and trading date (`teo`). The correlation endpoints align **stock** daily returns (gross or ERM3 residual) with those series and compute **Pearson** or **Spearman** correlation over the last `window_days` **paired** observations per factor (after date alignment). The implementation requires **at least about 30** overlapping paired days per factor; otherwise that factor’s entry is `null`.

### Factor keys (`factors` in JSON body; comma-separated `factors` or `factor` on GET)

| Key | Typical meaning |
|---|---|
| `bitcoin` | Bitcoin (digital asset) daily return |
| `gold` | Gold daily return |
| `oil` | Oil / energy-linked daily return |
| `dxy` | US Dollar Index (DXY) daily return |
| `vix` | VIX (volatility index) daily return |
| `ust10y2y` | US Treasury 10y minus 2y spread daily return |

Omit `factors` to use **all six** keys. **`null` in `correlations`** means insufficient overlap, missing `macro_factors` rows for that window, or too few points — it is **not** a sign error. **Negative** correlation (e.g. with `vix`) is **expected** for many names and is not a data bug.

### `return_type` (stock return series correlated to each macro factor)

| Value | Stock series |
|---|---|
| `gross` | Daily gross stock return (`returns_gross`). |
| `l1` | Residual vs **market only**: gross return minus `l1_market_hr` × SPY daily return. |
| `l2` | Residual vs **market + sector**: gross return minus (`l2_market_hr` × SPY return + `l2_sector_hr` × sector ETF return). Requires a **sector ETF** on the symbol; otherwise **400**. |
| `l3_residual` | Residual after **L3** hedge replication: gross return minus (`l3_market_hr` × SPY + `l3_sector_hr` × sector ETF + `l3_subsector_hr` × subsector ETF). Requires **sector and subsector** ETFs on the symbol; otherwise **400**. |

### Response fields (success)

| Field | Description |
|---|---|
| `correlations` | Object mapping each requested `factor_key` to a correlation coefficient (`number`) or `null`. |
| `overlap_days` | Largest count of paired observations used **among** the requested factors (after slicing to `window_days`). |
| `warnings` | Strings (e.g. empty `macro_factors` coverage for the window). |
| `_metadata` / `_agent` | Same lineage and telemetry pattern as other Risk Metrics routes (see response metadata docs). |

---

## Classification Fields

| Field | Description |
|---|---|
| `bw_sector_code` | Barra World (BW) sector classification integer |

`bw_sector_code` and internal industry-level mapping are used to assign sector and subsector ETFs for L2 and L3 regressions.

---

## Returns decomposition (`l*_cfr` / `l*_rr`)

These keys are **daily simple returns** (decimals, same convention as `returns_gross`) from the ERM3 **returns decomposition** dataset (`ds_erm3_returns_*` zarr: `combined_factor_return` and `residual_return` by level). They are **not** hedge ratios, **not** explained-risk variance fractions (`l*_res_er`), and **not** sourced from `ds_erm3_hedge_weights`.

| Wire key (JSON) | SDK name (after `METRICS_V3_TO_SEMANTIC`) | Unit | Meaning |
|---|---|---|---|
| `l1_cfr` | `l1_combined_factor_return` | decimal | Combined factor return through L1 (market) |
| `l1_rr` | `l1_residual_return` | decimal | Residual return at L1 |
| `l2_cfr` | `l2_combined_factor_return` | decimal | Combined factor return through L2 (sector) |
| `l2_rr` | `l2_residual_return` | decimal | Residual return at L2 |
| `l3_cfr` | `l3_combined_factor_return` | decimal | Combined factor return through L3 (subsector) |
| `l3_rr` | `l3_residual_return` | decimal | Residual return at L3 |

**Naming:** `*_cfr` = combined factor return; `*_rr` = residual **return** at that level. Do not confuse with the informal “RR” acronym for **residual risk** as a variance share in the [Key Concepts](README_API.md#rr--residual-risk) section of `README_API.md` (that usage refers to `l3_residual_er` and related ER fields).

### Geometric vs. arithmetic attribution over multi-period horizons

The `l*_cfr` and `l*_rr` fields are **daily simple returns**. Within a single day, summing the four L3 components recovers gross return exactly (the replication identity). Over multi-day horizons, arithmetic sums of these fields diverge from compound gross return due to volatility drag (Jensen's inequality).

The P1/DD waterfall chart and cumulative residual line use **geometric (sequential compounding) attribution**: returns are compounded through the ERM3 hierarchy level by level, producing bars that telescope to the exact geometric gross. No approximation or cross-term correction is involved. See [ENGINE_METHOD_NOTES.md §6](ENGINE_METHOD_NOTES.md) for the formula.

They appear in **`GET /metrics/{ticker}`** under `metrics` when synced, in long-form **`security_history`** as `metric_key` values, and as optional columns on **`security_history_latest`** after migration. Sync progress is tracked in **`erm3_sync_state_v3`** with `table_name = security_history_returns_decomp`. Backfill scope (e.g. Mag 7 vs full universe) is controlled in the ERM3 sync CLI (see [content/docs/returns-decomposition-metrics.mdx](content/docs/returns-decomposition-metrics.mdx) on the developer portal).

---

## `/ticker-returns` Column Aliases

The `/api/ticker-returns` endpoint returns a daily time series. Each row contains:

| Wire Key (JSON) | SDK Name (after `TICKER_RETURNS_COLUMN_RENAME`) | Unit | Description |
|---|---|---|---|
| `date` | `date` | ISO 8601 | Trading date |
| `returns_gross` | `returns_gross` | decimal | Daily gross stock return |
| `price_close` | `price_close` | USD | Closing price |
| `l3_mkt_hr` | `l3_market_hr` | dollar_ratio | SPY component of L3 hedge |
| `l3_sec_hr` | `l3_sector_hr` | dollar_ratio | Sector ETF component of L3 hedge |
| `l3_sub_hr` | `l3_subsector_hr` | dollar_ratio | Subsector ETF component (sign can be negative; see Sign convention) |
| `l3_mkt_er` | `l3_market_er` | decimal_fraction | Market variance share at L3 |
| `l3_sec_er` | `l3_sector_er` | decimal_fraction | Sector variance share at L3 |
| `l3_sub_er` | `l3_subsector_er` | decimal_fraction | Subsector variance share at L3 |
| `l3_res_er` | `l3_residual_er` | decimal_fraction | Idiosyncratic variance share at L3 |

**Wire vs SDK:** Raw JSON uses abbreviated keys (`l3_mkt_hr`, …). The Python SDK
(`riskmodels-py`) renames them to semantic names via `TICKER_RETURNS_COLUMN_RENAME`
in `sdk/riskmodels/mapping.py`.

**Nulls:** Trailing rows (near the end of the time series) may have null HR/ER
values where the rolling regression window has insufficient data.

**Negative ratios:** You may observe **negative values on any HR column** in the
time series (e.g. `l3_mkt_hr`, `l3_sec_hr`, `l3_sub_hr`). That is expected under
orthogonalization (neutralizing factors against one another); **negative market
HR at L2 or L3 is especially common**. It does not by itself indicate a sign
error in the underlying data.

---

## ERM3 zarr parity (`L*_ER` / `L*_HR`)

Batch responses use **`full_metrics`** (long keys like `l3_market_hr`) and **`hedge_ratios`** (short keys like `l1_market` for the same six hedge ratios). **`GET /metrics/{ticker}`** uses abbreviated keys (`l3_mkt_hr`, …). For a **zarr ↔ API name mapping**, holdings-weighted topic features, and example request JSON, see [docs/ERM3_ZARR_API_PARITY.md](docs/ERM3_ZARR_API_PARITY.md).

## Dataset Coverage

- **Universe**: ~3,000 US equities (`uni_mc_3000` — top market cap)
- **Date range**: 2006-01-04 to present
- **Update frequency**: Daily (end-of-day)
- **Backend**: Zarr v2 on Google Cloud Storage (`gs://rm_api_data/`) — three datasets: Returns, Betas, Hedge Weights
- **Regression method**: Huber/Ridge regression via the ERM3 computation engine
