---
description: CAPM cost of equity, book-weight WACC, and economic profit — caller-supplied ERP and rf tenor
argument-hint: "<ticker e.g. MSFT> [erp e.g. 0.05] [rf_tenor e.g. 10y]"
---

# Cost of capital (CAPM)

Compute cost of capital for `$ARGUMENTS` using the **cost-of-capital** skill.

1. Parse ticker, optional `erp`, and optional `rf_tenor` from the arguments.
2. If ERP is missing, ask for it or call `riskmodels_get_fundamentals` with `grid=true`.
3. Call `riskmodels_get_fundamentals` with `erp` / `rf_tenor` (and tax_rate if given). State ERP, tenor, and tax rate in the answer.

CAPM-mode only. Model outputs from realized data and caller assumptions — not a valuation opinion or recommendation.
