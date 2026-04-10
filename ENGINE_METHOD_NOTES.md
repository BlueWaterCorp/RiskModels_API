# ERM3 Engine Method Notes

This note is for users who want a compact description of the model-engineering choices behind the RiskModels API. It is not a marketing summary and it is not a full model specification. The goal is to explain three properties that matter for quantitative use: time safety, Security Master design, and the industry-level structure used in ERM3.

## Overview

RiskModels API outputs are produced by the ERM3 engine in the `ERM3` repository. At a high level, ERM3 is a hierarchical equity risk model with three regression layers:

- market
- sector
- subsector

The implementation is designed so that the published hedge ratios remain executable against raw ETFs, while the estimation step still enforces a hierarchical decomposition of explanatory power.

## 1. Time Safety

For quantitative users, "time safety" means more than avoiding obvious lookahead bias in returns. It also means not silently rewriting identity, shares, or membership history with information that only became known later.

ERM3 tries to enforce that in a few specific ways:

- **Validity-window joins.** Identity and shares records are stored with `valid_from` / `valid_to` windows, so point-in-time lookups can resolve the version of a record that was actually active on a given date.
- **Ticker recycling awareness.** The Security Master keeps `symbol_change_history` and supports `unique_ticker` handling so a reused ticker does not collapse multiple securities into one historical series.
- **Historical shares, not a single snapshot.** Market cap inputs are built from `shares_history`, not from today's shares count backfilled across the past. In practice this matters for universe construction and rank-based selection.
- **Output masking uses contemporaneous validity.** Final model outputs are filtered by `universe & validity` at each date rather than only by the latest live universe.
- **Expand-only symbol alignment.** When the symbol set changes, output zarrs are expanded rather than contracted. That preserves historical series for names that subsequently leave the universe and avoids retroactive deletion of coverage.

This does not mean the system is a perfect reconstruction of every vendor classification state at every historical instant. It does mean the engine is explicitly built to avoid several common sources of forward contamination: recycled tickers, snapshot shares, and retroactive universe contraction.

## 2. Security Master

The Security Master is the identity layer that sits underneath the model.

Its role is to provide a stable key for:

- identifier resolution
- historical symbol changes
- classification lookup
- shares history

The canonical identifier strategy is intentionally conservative: stronger vendor or exchange identifiers are preferred when available, with **other fallbacks including ticker** when needed. Ticker strings are the least stable identifier over long horizons, so the stack avoids relying on them alone when better keys exist.

Operationally, the Security Master contributes three things to the model quality:

1. **Identity continuity**
   Resolving `AAPL` in 2007 and `AAPL` today should not assume the same security unless the historical record supports that conclusion.

2. **Point-in-time classification**
   Sector and industry attributes are queried through a single interface that can respect an `as_of_date`, rather than assuming the latest classification is always the right one for backtests.

3. **Historically defensible market cap**
   Quarterly shares are stored with validity windows and forward-filled across the trading grid only within their active period. That is a much better approximation than using a single outstanding-shares field as if it were timeless.

For API users, the practical consequence is that ticker-level outputs sit on top of a more stable security-resolution layer than a plain ticker-to-row mapping.

## 3. Industry-Level Structure

ERM3 is deliberately not a flat factor model. The model uses a three-level hierarchy:

- **L1:** market ETF
- **L2:** market + sector ETF
- **L3:** market + sector + subsector ETF

The sector and subsector assignments are driven by structured classification fields in the engine:

- **sector level:** BW sector code
- **subsector level:** industry-level classification mapped into a maintained subsector ETF registry

This matters for two reasons.

First, it gives the model a more interpretable decomposition of explained risk. Instead of a single omnibus beta vector, the output separates what is attributable to the broad market, what is attributable to sector structure, and what remains at the finer industry bucket.

Second, the hedge ratios are designed to remain executable with liquid raw ETFs. Internally, ERM3 uses hierarchical estimation and link-beta adjustments so that:

- stock returns are decomposed layer by layer
- hedge ratios can still be applied directly to raw ETF returns at trade time

That distinction is important. The model is not asking downstream users to recreate orthogonalized synthetic factors in production. The orthogonalization is part of estimation; the published hedge ratios are intended to be used with actual ETFs.

## 4. What This Means for Quant Users

In practical terms, these design choices make the API more suitable for:

- backtests where identity continuity matters
- rank-based universes where historical market cap should be date-consistent
- sector/subsector neutralization workflows
- portfolio diagnostics that need a decomposition more granular than market-only beta

They do **not** eliminate normal model risk. The outputs are still statistical estimates built from historical returns and maintained classification mappings. Users should treat the API as a disciplined factor/hedging layer, not as a claim of perfect economic truth.

## 5. Scope and Caveats

A few caveats are worth stating directly:

- The model is **hierarchical and ETF-based**, not a full fundamental multi-factor risk system.
- "Time-safe" means the engine tries to preserve point-in-time identity, shares, and membership logic; it does not imply every upstream vendor field is historically perfect.
- Subsector mapping quality depends on the maintained registry and vendor classification inputs available to the engine.
- Hedge ratios and explained-risk fields are best interpreted as **portfolio construction tools**, not as forecasts.

## 6. Multi-Period Geometric Attribution

Summing daily factor return contributions arithmetically does not reconcile with compound gross returns over multi-day windows. The gap grows with volatility and horizon (Jensen's inequality); for a 39% vol name over one year the error is approximately `vol²/2 ≈ 7pp`.

The snapshot waterfall and cumulative residual line use **sequential compounding** through the ERM3 hierarchy to decompose compound returns exactly:

```
prod_L1 = ∏(1 + mkt_t)                  # compound market-only
prod_L2 = ∏(1 + mkt_t + sec_t)          # compound through sector
prod_L3 = ∏(1 + mkt_t + sec_t + sub_t)  # compound through subsector
prod_G  = ∏(1 + gross_t)                 # actual gross compound

market_bar    = prod_L1 - 1
sector_bar    = prod_L2 - prod_L1
subsector_bar = prod_L3 - prod_L2
residual_bar  = prod_G  - prod_L3
```

Properties:

- **Exact.** Bars sum to `prod_G - 1` by construction (telescoping cancellation). No cross-term remainder.
- **Hierarchy-respecting.** Each product compounds returns as if only factors through that level contribute, mirroring the L1→L2→L3 regression cascade.
- **Consistent.** The cumulative residual line uses the same definition: `prod_G(t) - prod_L3(t)` at each date `t`, so the line endpoint equals the residual bar.

This attribution is descriptive (ex-post decomposition of realised returns), not a forecast. The same caveats about noisy beta estimates from §5 apply.

## Summary

If you strip away the implementation detail, the relevant message for a quant audience is simple:

- ERM3 is built to be more time-safe than a naive ticker-snapshot pipeline.
- The Security Master is a real modeling dependency, not just a convenience table.
- The industry structure is explicit, hierarchical, and intended to support executable market/sector/subsector hedging rather than only descriptive analytics.
