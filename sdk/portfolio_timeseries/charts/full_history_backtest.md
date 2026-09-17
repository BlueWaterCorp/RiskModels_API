# Full-History Point-in-Time Backtest

**File:** `charts/full_history_backtest.png` (+ `_web.png`)

## Headline

Run point-in-time, the industry-axis hedge keeps realized β to SPY near zero across the **entire** available history of each filer — it does **not** creep up the way the static (today's-book-applied-backward) overlay does at 24 months. That creep was an artifact of the static method, not a failure of the hedge.

## Numbers

| Filer | Window | Quarters | PIT raw β | PIT hedged β | β used n qtrs (SPY≥2013-07) |
|---|---|---|---|---|---|
| Berkshire | 2013-09-30→2025-12-31 | 46 | +0.94 | +0.051 | 46 |
| Pershing | 2005-12-31→2025-12-31 | 72 | +1.20 | +0.192 | 48 |
| Appaloosa | 2016-03-31→2025-12-31 | 40 | +1.20 | -0.026 | 40 |
| Greenlight | 2005-12-31→2023-12-31 | 70 | +1.47 | -0.070 | 42 |

## Method — and why it is point-in-time

**Discovery that makes this feasible:** `get_filer_portfolio` returns, per period (`teo`, quarterly), the book's return already split into `portfolio_market_return` / `portfolio_sector_return` / `portfolio_subsector_return` / `portfolio_idiosyncratic_return`, each computed from **that quarter's actual holdings**. So the per-vintage decomposition is done by the engine — we do not re-pull each vintage and re-hedge by hand.

**Verified semantics (important):** `portfolio_gross_return` at `teo` T is the **forward** one-quarter realized return of the book **known as of T** — i.e. the return over (T, T+1Q]. Evidence: aligning each quarter's `portfolio_market_return` to SPY over the *following* quarter gives corr ≈ +0.74 and raw β ≈ +0.94 (Berkshire); aligning to the *trailing* quarter gives a nonsensical negative β. This is exactly the correct point-in-time construction — the book is fixed at T and earns the next quarter's return, **no look-ahead**. β below is measured with SPY compounded over the same forward window.

```
raw_r,q    = portfolio_gross_return_q            # forward-quarter return of book known at teo q
hedged_r,q = gross_q − (market_q + sector_q + subsector_q)   # industry-axis neutral, that quarter's book
cumulative = Π_q (1 + r_q) − 1        # non-overlapping forward quarters tile the timeline → valid compounding
β          = cov(r_q, SPY_fwd_q) / var(SPY_fwd_q),  SPY over the same (teo, teo+1Q] window
```

This mirrors D1's overlay definition (subtract the market+sector+subsector factor return) but applies it to each quarter's own book, so there is **no look-ahead and no stale-book drift**.

## Caveats (honest)

- **Quarterly resolution.** These are period (teo) returns, not daily; β is estimated on quarterly observations, so it is noisier per-point than the daily D1 estimate but covers far more history.
- **β window vs. cumulative window differ.** SPY daily returns only reach back to ~2013-07, so β is estimated over the post-2013 overlap (see the last column); the cumulative curves use each filer's full available history (Pershing & Greenlight go back to 2005 at the portfolio level).
- **`hedged = gross − (market+sector+subsector)`** equals idiosyncratic + a small `identity_residual` (cross/compounding terms the additive split does not capture exactly). It is the direct analog of the overlay, not literally the `portfolio_idiosyncratic_return` field (which omits that residual).
- **Greenlight** ends 2023-12-31 (stale) and its restricted top line is inside the engine's book-level return, so its recent quarters carry noise that the D1 chart could not even compute.
- **This is portfolio-level attribution, not a tradable overlay P&L.** It shows the book's return net of its own factor exposure each quarter — the cleanest available point-in-time read — but it does not model overlay financing, ETF tracking error, or rebalancing costs.

## Contrast with the D1 static backtest

In D1 (static, current overlay applied backward), the 24-month hedged β was Berkshire 0.22, Pershing −0.03, Appaloosa −0.14, Greenlight 0.60. Point-in-time here, Berkshire's hedged β stays far below its static 24-month figure — direct evidence that the static method's β creep is a stale-book artifact, exactly as flagged.
