---
description: Decompose a US stock into market / sector / subsector / residual risk with ETF hedge ratios (ERM3 L1/L2/L3)
argument-hint: "<ticker e.g. NVDA>"
---

# Risk decompose

Decompose `$ARGUMENTS` using the **risk-decompose** skill and the hosted RiskModels MCP.

1. Resolve the symbol if needed (`riskmodels_search_tickers`).
2. Call `riskmodels_get_hedge_levels` and/or `riskmodels_decompose` (and `get_metrics` if a latest snapshot is enough).
3. Lead with where variance lives (`*_er`); report hedge ratios as mechanical neutralization math, not trade advice.

Realized/historical only — not investment advice.
