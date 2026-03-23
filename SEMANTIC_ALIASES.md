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
| `l3_subsector_hr` | Subsector ETF component of the L3 hedge — **can be negative** (long position) | -0.3 – 0.4 |

### Sign Convention

- `l3_subsector_hr` is the only HR field that can be **negative**. A negative value means a long (not short) position in the subsector ETF is required for L3 hedging.
- All other HR fields are positive under normal conditions. A negative `l1_market_hr` is unusual and may indicate a ticker not well-modelled by SPY — check with `GET /api/tickers?search=SYMBOL`.

### Hedge Levels

| Level | Trades | ETFs Used | Use Case |
|---|---|---|---|
| **L1** | 1 | SPY only | Quick market-neutral hedge |
| **L2** | 2 | SPY + sector ETF | Remove market + sector exposure |
| **L3** | 3 | SPY + sector + subsector ETF | Institutional-grade, full factor neutrality |

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

## Classification Fields

| Field | Description |
|---|---|
| `bw_sector_code` | Barra World (BW) sector classification integer |
| `fs_sector_code` | FactSet sector code integer |
| `fs_industry_code` | FactSet industry code integer |

These codes are used internally to assign sector and subsector ETFs for L2 and L3 regressions.

---

## `/ticker-returns` Column Aliases

The `/api/ticker-returns` endpoint returns a **rolling** (time-varying) combined hedge ratio per day, not the six individual HR components. The column mapping used in the quickstart notebook:

| Response Column | Meaning | Relation to HR Fields |
|---|---|---|
| `stock` | Daily gross return of the stock | — |
| `l1` | Rolling L1 combined market hedge ratio | Equivalent to `l1_market_hr` (rolling) |
| `l2` | Rolling L2 combined (market + sector) hedge ratio | Sum of `l2_market_hr` + `l2_sector_hr` (weighted) |
| `l3` | Rolling L3 combined (full) hedge ratio | Sum of `l3_market_hr` + `l3_sector_hr` + `l3_subsector_hr` (weighted) |

For the **six separate components** (individual SPY / sector / subsector notionals), use `/api/metrics/{ticker}`.

---

## ERM3 zarr parity (`L*_ER` / `L*_HR`)

Batch responses use **`full_metrics`** (long keys like `l3_market_hr`) and **`hedge_ratios`** (short keys like `l1_market` for the same six hedge ratios). **`GET /metrics/{ticker}`** uses abbreviated keys (`l3_mkt_hr`, …). For a **zarr ↔ API name mapping**, holdings-weighted topic features, and example request JSON, see [docs/ERM3_ZARR_API_PARITY.md](docs/ERM3_ZARR_API_PARITY.md).

## Dataset Coverage

- **Universe**: ~3,000 US equities (`uni_mc_3000` — top market cap)
- **Date range**: 2006-01-04 to present
- **Update frequency**: Daily (end-of-day)
- **Backend**: Zarr v2 on Google Cloud Storage (`gs://rm_api_data/`) — three datasets: Returns, Betas, Hedge Weights
- **Regression method**: Huber/Ridge regression via the ERM3 computation engine
