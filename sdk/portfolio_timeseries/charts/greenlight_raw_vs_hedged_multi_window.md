# Greenlight — Raw vs. Hedged (multi-window)

**File:** `charts/greenlight_raw_vs_hedged_multi_window.png` (+ `_web.png`)  
**Book:** report date 2023-12-31  ·  12/14 positions with return coverage (71% of gross long $)  ·  15 overlay ETFs  ·  499 trading days of returns

## What it shows

Four panels (3 / 6 / 12 / 24-month) of cumulative return for the Greenlight disclosed long book, *raw* (navy) vs. *hedged* with the market-neutral industry-axis overlay (orange). The hedged line should drift far less and its realized β to SPY should sit near zero.

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
| 3-month | 63 | +0.17 | +0.075 | 55% |
| 6-month | 126 | +0.51 | +0.225 | 56% |
| 12-month | 252 | +0.66 | +0.314 | 52% |
| 24-month | 499 | +1.05 | +0.599 | 43% |

## Caveats

- **Static overlay applied backward:** today's book / overlay is held fixed across all windows (same limitation as the Berkshire chart). The point-in-time per-vintage version is Deliverable 4.
- **Positions without returns (excluded from raw):** BW-RESTRICTED, BW-BBG001LWHLJ8.
- **⚠ Greenlight book is STALE (2023-12-31, ~2 years old).** Applying a Dec-2023 book to 2024–2026 returns is a coverage stretch — the raw series reflects positions the manager may have exited. Its top line (~27.5%) is a confidential-treatment `BW-RESTRICTED` row with no ticker, so it is dropped from the return series entirely. Read these betas as indicative only, NOT a like-for-like comparison with the live filers.
