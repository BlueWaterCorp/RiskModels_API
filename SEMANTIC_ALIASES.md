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

### `POST /decompose` — agent-friendly semantic wrapper

`POST /decompose` returns the **four-bet** shape (`market`, `sector`, `subsector`, `residual`) under `exposure.<layer>.{er, hr, hedge_etf}`, plus a top-level `hedge` map of ETF → dollar ratio (= **negative** of each tradable layer's `hr`, summed across duplicate ETFs). This is a thin semantic re-projection of the same `l3_*_hr` / `l3_*_er` fields documented above — no new math, same billing as `GET /metrics/{ticker}`. Use it when an agent only needs the additive bet breakdown + ready-to-short hedge notionals.

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

**Raw series (no ticker):** `GET /api/macro-factors` returns long-format rows from `macro_factors` for a requested date range. **JSON Schema:** `https://riskmodels.app/schemas/macro-factors-series-v1.json`. Query params: optional comma-separated `factors` (or `factor`), optional `start` / `end` (`YYYY-MM-DD`). Defaults: all 18 canonical keys (10 macro + 8 style), `end` = today (UTC), `start` = five calendar years before `end`; maximum span 20 years.

Daily **factor returns** are stored in Supabase `macro_factors` as `return_gross` per `factor_key` and trading date (`teo`). Two sleeves share the table: the **macro sleeve** (mirrored from `ds_macro_factor.zarr`) and the **style sleeve** (mirrored from `ds_etf.zarr`). Rows in the style sleeve carry `metadata.category = "style"` so callers can distinguish the two without parsing factor names. The correlation endpoints align **stock** daily returns (gross or ERM3 residual) with those series and compute **Pearson** or **Spearman** correlation over the last `window_days` **paired** observations per factor (after date alignment). The implementation requires **at least about 30** overlapping paired days per factor; otherwise that factor’s entry is `null`.

### Factor keys (`factors` in JSON body; comma-separated `factors` or `factor` on GET)

**Macro sleeve (10 keys — backed by `ds_macro_factor.zarr`):**

| Key | Underlying | Typical meaning |
|---|---|---|
| `inflation` | TIP | US TIPS — inflation expectations proxy |
| `term_spread` | VGIT | Intermediate Treasury — long-end / slope proxy (`ust10y2y` legacy alias) |
| `short_rates` | BIL | 1–3mo Treasury bills — short-rate proxy |
| `credit` | HYG | High-yield corporate — credit spread proxy |
| `oil` | USO | WTI crude daily return |
| `gold` | GLD | Gold daily return |
| `usd` | UUP | US Dollar (DXY) daily return (`dxy` legacy alias) |
| `volatility` | VXX | VIX short-term futures — captures roll cost (`vxx` alias) |
| `bitcoin` | BITO | Bitcoin futures ETF (`btc` alias) |
| `vix_spot` | FRED VIXCLS | Pure spot VIX (`vix` legacy alias) |

**Style sleeve (8 keys — mirrored from `ds_etf.zarr` into `macro_factors`):**

| Key | Underlying | History | Interpretation |
|---|---|---|---|
| `momentum` | MTUM | 2013-04– | MSCI USA Momentum |
| `quality` | QUAL | 2013-07– | MSCI USA Quality |
| `low_vol` | USMV | 2011-10– | MSCI USA Min Vol (`minvol` alias) |
| `value` | VLUE | 2013-04– | MSCI USA Value |
| `growth` | IWF | 2000-05– | Russell 1000 Growth |
| `size` | IWM | 2000-05– | Russell 2000 small-cap (`small_cap` alias) |
| `dividend` | SCHD | 2011-10– | Schwab US Dividend Equity (`div`, `yield` aliases) |
| `moat` | MOAT | 2012-04– | VanEck Wide Moat |

Style factors are most informative when combined with `return_type=l3_residual`: because the ERM3 residual is already orthogonal to SPY, the sector ETF, and the subsector ETF, correlation with the raw style-ETF return isolates the pure style tilt (the market and sector components embedded in style ETFs contribute zero to the correlation by construction).

Omit `factors` to use **all 18** canonical keys. **`null` in `correlations`** means insufficient overlap (including pre-launch windows for short-history MSCI factors), missing `macro_factors` rows for that window, or too few points — it is **not** a sign error. **Negative** correlation (e.g. with `vix` or `low_vol`) is **expected** for many names and is not a data bug.

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

They appear in **`GET /metrics/{ticker}`** under `metrics` when synced, in **Zarr-backed daily history** returned by the API (for example `GET /ticker-returns`), and as optional wide columns on **`security_history_latest`** after migration. Sync progress is tracked in **`erm3_sync_state_v3`** with `table_name = security_history_returns_decomp`. Backfill scope (e.g. Mag 7 vs full universe) is controlled in the ERM3 sync CLI (see [content/docs/returns-decomposition-metrics.mdx](content/docs/returns-decomposition-metrics.mdx) on the developer portal).

---

## Cohort residual statistics (`GET /cohorts`, `GET /cohorts/series`, `GET /cohorts/roster`, `POST /cohorts/pnl-decomposition`)

These 19 variables come from the ERM3 **cohort store** (`ds_erm3_cohorts`) — the first ERM3 artifact published at **cohort** level rather than per-stock. A **cohort** is the market (level 1) or a GICS sector (level 2), and every statistic is a **cross-sectional** summary across that cohort's member stocks on one trading date (`teo`). Public scope is **SPY plus the 11 GICS sector SPDRs**; cohorts are addressed by **ticker** (the store's internal join key is never serialized).

Unless a row says otherwise, values are **daily** — same convention as `returns_gross` and the `l*_rr` fields — not annualised and not cumulative.

### Residuals are not zero-mean (the no-intercept contract)

ERM3 regressions are fitted **without an intercept**, deliberately, so each stock's residual retains its alpha. The consequence is that the **cross-sectional mean residual is not zero**, and `residual_mean` is that quantity per (`teo`, cohort). It is what you subtract to demean a relative-ranking signal:

```
demeaned_i,t = ε_i,t − residual_mean(cohort(i), t)
```

**The level must match.** A cohort's `residual_mean` is the mean of its members' residuals **at that cohort's level** — a market cohort holds market-level (`l1_rr`) means, a sector cohort holds sector-level (`l2_rr`) means. Demeaning an `l2_rr` series against the market cohort mixes two different quantities.

**Never quote a drift figure without both its window and its cascade level** (and, where it matters, its population). The sign is not stable across the sample. Two correctly-labelled realized figures, equal-weighted, measured on the published panel:

| Level | Window | Population | Mean residual |
|---|---|---|---|
| market (L1) | 2014–2026 | market cohort members | −3.68 %/yr |
| market (L1) | 2000–2026 | market cohort members | +2.09 %/yr |

Both rows are the **same level and the same population** — only the window differs, and the sign still flips. That is the point: a drift figure is meaningless without its window. Changing the level moves it again (the equal-weighted mean across the 11 sector cohorts runs −2.89 %/yr and +2.76 %/yr over those same two windows), and changing the population moves it a third time — an equal-weighted mean *across cohorts* is not the same statistic as an equal-weighted mean *across stocks*, because cohorts differ in size.

Neither row is "the" drift. Re-derive the number for the level, window, and population you actually care about rather than quoting any of these. These are realized historical measurements, not forecasts.

`no_intercept_contract` in the `disclosures` block is read **from the store's own attributes**, not restated by the API, so it cannot drift from the data it describes.

### Distribution fields

Cross-sectional shape of member residuals within the cohort on that day.

| Field | Unit | Description |
|---|---|---|
| `residual_mean` | decimal (daily) | **Equal-weighted** mean member residual — the quantity to subtract when demeaning a relative-ranking signal at this level. |
| `residual_mean_cw` | decimal (daily) | Cap-weighted equivalent. The EW/CW wedge is itself informative. |
| `residual_sd` | decimal (daily) | Cross-sectional dispersion of member residuals — how much selection opportunity exists in the cohort. Read with `mean_pairwise_corr`. |
| `residual_skew` | dimensionless | Cross-sectional skewness of member residuals. |
| `residual_p10` | decimal (daily) | Cross-sectional 10th-percentile member residual. |
| `residual_p90` | decimal (daily) | Cross-sectional 90th-percentile member residual. |
| `mean_pairwise_corr` | dimensionless (−1 to 1) | Mean pairwise correlation of member residuals, from a **63-day identity-based estimator**. |

**`residual_sd` is a conditioning and allocation variable, not an alpha source.** It **multiplies** skill and cannot create it — zero IC times a well-timed gross multiplier is still zero. It does not predict returns and must not be described as a signal. Always read it alongside `mean_pairwise_corr`, which separates idiosyncratic dispersion from common movement: dispersion conflates the two.

**`mean_pairwise_corr` is an estimate, not a measured matrix.** It inverts the portfolio-variance relation `var(mean of n) = avg_var/n + avg_cov·(n−1)/n` over a 63-day window rather than forming a full pairwise correlation matrix. Do not present it to high precision.

### Breadth fields

| Field | Unit | Description |
|---|---|---|
| `n_names` | integer count | Member count that day. **Guards every other statistic.** |
| `n_effective` | dimensionless | **Inverse-Herfindahl breadth** of the cohort's weights. |
| `weight_top1` | decimal_fraction | Largest constituent weight — concentration. |
| `membership_churn` | integer count | Names entering + leaving versus the previous `teo`. |

**Prefer `n_effective` over `n_names` for anything power- or breadth-related.** A cohort of 40 names dominated by one constituent has the statistical breadth of far fewer, and inverse-Herfindahl breadth is often well below the headcount.

**Thin cohorts give meaningless statistics.** A four-name cohort's `residual_mean` and `residual_sd` are noise. Filter with `min_names` on any of the cohort endpoints; days (or cohorts) below the threshold are **dropped, not zero-filled**.

### Factor linkage fields

The cohort's own factor return and its relationship to its parent's (sector → market).

**`cohort_factor_return` is the RAW proxy return — it is not net of anything.** It is the cohort's proxy instrument's own dividend-adjusted total return, the same number `GET /api/etf/factor-returns` serves for the public sleeve. The market-cleaned series that the published sector and subsector **betas** multiply is `cohort_residual_return`. Three published quantities carry the words "factor return" and they are three different things:

| Quantity | What it is | Net of the market? |
|---|---|---|
| `cohort_factor_return`, and `/api/etf/factor-returns` | the proxy instrument's own total return | no |
| `cohort_residual_return` | that return, cleaned of every higher level | yes |
| `l2_fr` / `l3_fr` (returns decomposition) | a **stock's** incremental contribution, `β × cleaned factor return` | yes, and already multiplied by β |

Applying `l2_sector_beta` to `cohort_factor_return` double-counts the market. Applying a hedge ratio (`l3_sec_hr`) to it is correct — hedge ratios are defined against raw ETF returns. The transform between the two coefficient sets is derived on the [methodology page](https://riskmodels.org/methodology).

| Field | Unit | Description |
|---|---|---|
| `linked_beta` | dimensionless | Beta of this cohort's factor to its parent's, from a 252-day rolling regression (`min_periods` 126). Orthogonal basis: it multiplies the **cleaned** parent level, never the raw parent instrument. Equal to `beta_parent_orth` at both levels. |
| `link_fit_resid_sd` | decimal (daily) | Residual standard deviation of that 252-day link regression — how much of the cohort factor its parent does **not** explain, in return units. See the caution below. |
| `linked_beta_r2` | decimal_fraction | R² of that regression — the **cohort factor's** fit on its parent. **Not** the same quantity as `cohort_ER`. |
| `linked_beta_roll63` | dimensionless | 63-day variant of `linked_beta`. Divergence from `linked_beta` is beta *instability*, which is itself informative. |
| `cohort_factor_return` | decimal (daily) | The cohort's proxy instrument's own total return, **raw** — not net of the market. See the note above. |
| `cohort_residual_return` | decimal (daily) | The factor return cleaned of every higher level. **L2 (sector):** `cohort_factor_return − linked_beta × market factor return`. **L3 (subsector):** `cohort_factor_return − beta_market_orth × market factor return − linked_beta × parent's cohort_residual_return` — note the market term, and note the parent enters **cleaned**, not raw. |
| `cohort_ER` | decimal_fraction | Mean **member's** explained risk attributed to this cohort's level. Incremental, can be slightly negative — see below. |
| `factor_source` | integer code | Provenance of the factor return that day. `0` = native; non-zero means a substitute instrument backed it. |

**`link_fit_resid_sd` is not a standard error of `linked_beta`.** It is the residual SD of the link regression — a fit-quality / dispersion measure in daily-return units. Nothing in the store carries the sampling uncertainty of `linked_beta`; do not build confidence intervals from this field. (The former name `linked_beta_se` was removed on 2026-08-25; it was never a standard error.)

**`cohort_ER` is an incremental attribution (`er_level − er_prev`), not an R² share.** It can be slightly negative and does **not** sum to 1 — do not clamp it to [0, 1] or render it as a percentage of a total. It is a different quantity from `linked_beta_r2` (measured correlation ≈ **−0.15**): `cohort_ER` is the *average member stock's* explained variance at this level, while `linked_beta_r2` is the *cohort factor's* explained variance against its parent factor. Never write "explained variance" for either without saying **whose**.

### `factor_source` codes

| Code | Meaning |
|---|---|
| `0` | Native — the cohort's own instrument return |
| `1` | Primary proxy (a real ETF standing in) |
| `2` | Chain proxy (a deeper real ETF standing in) |
| `3` | Synthetic free-float index |
| `9` | No data |

Any non-zero code means a **substitute instrument** backed the factor that day, so spliced history is not the same basket as the cohort's own. **Two sector cohorts are majority-proxied over the full panel**, which makes this material on long windows. `include_proxy_source=true` on `GET /cohorts/series` adds a per-day `proxy_source` label naming the backing instrument (resolved to a ticker). The store's own `return_source_legend` is echoed in `disclosures`.

### Response-level fields

| Field | Endpoint | Unit | Description |
|---|---|---|---|
| `proxied_fraction` | `/cohorts/series` (per cohort) | decimal_fraction | Share of the returned days whose factor came from a substitute instrument (`factor_source != 0`). **Callers must surface this** — a long-history chart that hides it is showing partly a different basket. |
| `min_names` | `/cohorts`, `/cohorts/series` | integer count | The thin-cohort filter that was applied (echoed back). |
| `disclosures` | all cohort endpoints | object | Interpretation notes that govern correct use: `no_intercept_contract`, `return_source_legend`, `coverage`, `dispersion_use`, `er_sign`, `thin_cohorts`. The first two are read from the store's attributes. |

### Selection vs drift (`POST /cohorts/pnl-decomposition`)

Splits a constant-weight book's **realized** residual return into what it earned by picking names and what it earned by being net long (or short) the average stock. Adding and subtracting each name's cohort mean splits the daily residual return exactly:

```
R_t = Σ_i w_i·(ε_i,t − μ_c(i),t)  +  Σ_c W_c·μ_c,t
      └──── selection ────┘          └──── drift ────┘
```

where `w_i` is a position weight, `ε_i,t` its residual, `μ_c,t = residual_mean` for its cohort, and `W_c` the net weight in cohort `c`.

| Field | Unit | Description |
|---|---|---|
| `totals.selection` | decimal | Cumulative return earned by holding names that beat their cohort's average residual. |
| `totals.drift` | decimal | Cumulative return earned from net exposure to that cohort average, which accrues on net weight **regardless of any selection skill**. |
| `totals.residual` | decimal | Cumulative residual return of the book. Equals `selection + drift`. |
| `totals.selection_share` | decimal_fraction | `abs(selection) / (abs(selection) + abs(drift))`. `null` when both are ≈ 0. |
| `by_cohort[].net_weight` | decimal | Sum of position weights in that cohort — the weight the cohort's drift accrued on. Negative for a net-short cohort. |

**`selection` and `drift` sum to the total residual return exactly.** This is an **identity**, not a fitted attribution — there is no regression, no residual-of-the-residual term, and no cross-term.

Levels must match here too: `level=sector` (default) demeans each name's sector-level residual against its sector cohort; `level=market` demeans market-level residuals against the market cohort. Weights are treated as **constant** over the window and are **not normalized** — rescaling them changes `drift`, which is proportional to net weight. Positions that cannot be resolved or mapped to an addressable cohort are dropped and named in `coverage.dropped`.

This is realized historical attribution of a stated weight vector — not a forecast, not a backtest of a strategy, and not a recommendation regarding any security.

### Cohort coverage

- **Cohorts cover ~88% of eligible universe names.** The shortfall is names whose sector code maps to no ETF proxy — a real, bounded gap, not a data error.
- **Panel starts 2000-01-03**, but **full factor richness begins around 2006**; earlier history leans on proxy or synthetic backfill, flagged per-day by `factor_source`.
- Values are `null` where the statistic is undefined for that day; rows below `min_names` are dropped rather than returned as noise.

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
error in the underlying data. **Do not equate a negative `l3_market_hr` with
“negative market exposure” or “betting against SPY” in isolation** — at L3,
sector and subsector legs embed market beta; the SPY hedge ratio is one leg of a
**joint** three-ETF replication. Use **`l3_mkt_er`** (variance share) for how much
risk sits in the market layer at L3, not the sign of `l3_market_hr` alone.

---

## ERM3 zarr parity (`L*_ER` / `L*_HR`)

Batch responses use **`full_metrics`** (long keys like `l3_market_hr`) and **`hedge_ratios`** (short keys like `l1_market` for the same six hedge ratios). **`GET /metrics/{ticker}`** uses abbreviated keys (`l3_mkt_hr`, …). For a **zarr ↔ API name mapping**, holdings-weighted topic features, and example request JSON, see [docs/ERM3_ZARR_API_PARITY.md](docs/ERM3_ZARR_API_PARITY.md).

## Dataset Coverage

- **Universe**: ~3,000 US equities (`uni_mc_3000` — top market cap)
- **Date range**: 2000 to present (deep panel; stock-specific skill series from ~2001 after warmup)
- **Update frequency**: Daily (end-of-day)
- **Backend**: Zarr v2 on Google Cloud Storage (`gs://rm_api_data/`) — three datasets: Returns, Betas, Hedge Weights
- **Regression method**: Huber/Ridge regression via the ERM3 computation engine
