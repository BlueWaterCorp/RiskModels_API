# Appaloosa — Raw vs. Hedged (multi-window)

**File:** `charts/appaloosa_raw_vs_hedged_multi_window.png` (+ `_web.png`)  
**Book:** report date 2025-12-31  ·  25/25 positions with return coverage (100% of gross long $)  ·  20 overlay ETFs  ·  499 trading days of returns

## What it shows

Four panels (3 / 6 / 12 / 24-month) of cumulative return for the Appaloosa disclosed long book, *raw* (navy) vs. *hedged* with the market-neutral industry-axis overlay (orange). The hedged line should drift far less and its realized β to SPY should sit near zero.

## How it was computed

```
raw_t    = Σ_i w_i · r_i,t              (disclosed dollar weights, renormalized over covered names)
hedged_t = raw_t − Σ_j (short_j/gross_long) · r_etf_j,t
```
- `r` = daily gross returns from `get_ticker_returns` (stocks + ETFs), trailing 2y.
- `short_j` = netted overlay ETF shorts from `decompose()` per-dollar hedge ratios (cached in `charts/overlay_data.json`).
- Realized β = cov(series, SPY) / var(SPY) over each window.

## Per-window betas

| Window | Days | Raw β | Hedged β | β reduction |
|---|---|---|---|---|
| 3-month | 63 | +1.66 | +0.061 | 96% |
| 6-month | 126 | +1.53 | +0.008 | 100% |
| 12-month | 252 | +1.52 | +0.011 | 99% |
| 24-month | 499 | +1.31 | -0.136 | 110% |

## Caveats

- **Static overlay applied backward:** today's book / overlay is held fixed across all windows (same limitation as the Berkshire chart). The point-in-time per-vintage version is Deliverable 4.
