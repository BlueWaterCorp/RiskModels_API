---
description: ETF hedge legs for a position or weighted book (ERM3 cascade + Lstar residual isolation)
argument-hint: "<TICKER:WEIGHT ... e.g. NVDA:0.4 MSFT:0.35 XOM:0.25>"
---

# Portfolio hedge

Build hedge legs for `$ARGUMENTS` using the **portfolio-hedge** skill.

1. Parse tickers and weights (equal-weight a single ticker if no weight given).
2. Call `riskmodels_decompose` with `dollars` for one position, or `riskmodels_analyze_portfolio` with dollar positions for a book (and `riskmodels_get_residual_returns` when isolating residual return).
3. Frame each ETF leg as what it would mechanically neutralize. Never recommend placing the hedge.

Realized/historical only — not investment advice.
