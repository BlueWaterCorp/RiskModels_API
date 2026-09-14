# Risk Decomposition (stacked) — all filers

**File:** `charts/risk_decomposition_stacked.png` (+ `_web.png`)

## What it shows

One stacked bar per filer: the proportion of total risk attributable to **market**, **sector**, **subsector**, and **residual (stock-specific)** risk. Read left-to-right, it makes the point that **different managers carry different risk profiles** — the mix is not the same across books.

## Numbers

| Filer | Book | n | Market | Sector | Subsector | Residual |
|---|---|---|---|---|---|---|
| Berkshire | 2025-12-31 | 21/22 | 16.8% | 22.0% | 0.7% | 60.5% |
| Pershing | 2025-12-31 | 6/7 | 19.8% | 8.4% | 1.8% | 70.0% |
| Appaloosa | 2025-12-31 | 25/25 | 20.9% | 9.6% | 5.1% | 64.4% |
| Greenlight | 2023-12-31 | 10/14 | 3.3% | 3.9% | 5.2% | 87.5% |

## How it was computed

For each disclosed, decomposable position, `decompose()`'s `hedge_levels.L3` exposes `market_er`, `sector_er`, `subsector_er`, `residual_er` — each the share of that position's total, summing to ~1.0 (verified, e.g. AAPL 0.227 + 0.009 + 0.006 + 0.759 = 1.00). The chart is the **dollar-weighted mean** of those four shares across the book, renormalized to 100%. This is the decompose engine's own variance-style split aggregated by dollar weight — **not** a proxy derived from hedge ratios.

## Caveats

- `er` is the engine's exposure/explained-return share, not a portfolio-variance computation with cross-position covariances; it treats each position's split independently and dollar-weights them. It answers 'where does the average dollar's risk sit', which is the intended read.
- Restricted / unresolved rows (`BW-RESTRICTED`, unresolved FIGIs) carry no decomposition and are excluded — most material for **Greenlight** (its top ~27.5% line is restricted), so its bar reflects only the decomposable remainder of a stale (2023-12-31) book.
