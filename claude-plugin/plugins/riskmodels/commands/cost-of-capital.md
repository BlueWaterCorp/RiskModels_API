---
description: CAPM cost of equity, strict and proxy book-weight WACC, and equity-charge economic profit — explicit ERP assumption and rf tenor
argument-hint: "<ticker e.g. MSFT> [erp e.g. 0.05] [rf_tenor e.g. 10y]"
---

# Cost of capital (CAPM)

Compute cost of capital for `$ARGUMENTS` using the **cost-of-capital** skill.

1. Parse ticker, optional `erp`, and optional `rf_tenor` from the arguments.
2. If ERP is missing, ask for it or call `riskmodels_get_fundamentals` with `grid=true`.
3. Call `riskmodels_get_fundamentals` with `erp` / `rf_tenor` (and tax_rate if given). State ERP, tenor, and tax rate in the answer.
4. Prefer strict `cost_of_debt` / `wacc`. If they are null and proxy status is `used`, report `cost_of_debt_imputed` / `wacc_imputed` separately as a PIT-lagged high-quality-market proxy with provenance.

CAPM-mode only. Model outputs from realized data and explicit request assumptions — not a valuation opinion or recommendation.
