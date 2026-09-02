---
name: cost-of-capital
description: >
  Compute a CAPM cost of equity, cost of debt, book-weight WACC, and economic profit
  for a US equity from its point-in-time fundamentals, with the equity risk premium
  and risk-free tenor supplied by the caller. Includes an ERP × rf-tenor sensitivity
  grid. Use when asked for a name's WACC, cost of equity, hurdle rate, or economic
  profit / EVA.
argument-hint: "[ticker] [erp?] [rf_tenor?]"
---

# Cost of capital (CAPM mode)

Report a name's cost of capital from its PIT fundamentals. Cost of equity is CAPM:
risk-free rate at the chosen tenor plus the ERM3 conditional market beta times the
caller-supplied equity risk premium. WACC uses book-value weights. This skill wraps
the hosted RiskModels MCP and reports its outputs — it computes nothing itself.

## What to call

- **`riskmodels_get_fundamentals`** — the cost-of-capital layer rides on this tool.
  Relevant params:
  - **`erp`** — the equity risk premium. **Always caller-supplied — never hardcode
    or assume one.** If the user did not give an ERP, ask for it or report across the
    grid; state the ERP used in every answer.
  - **`rf_tenor`** — Treasury constant-maturity tenor for the risk-free rate
    (`3m|1y|2y|5y|10y|30y`, default `10y`, the long-duration valuation convention).
  - **`tax_rate`** — applied to the WACC debt shield (default 0.21).
  - **`grid=true`** with `erp_grid` / `rf_tenor_grid` — returns the sensitivity table
    of `cost_of_equity` / `wacc` / `economic_profit` across every ERP × tenor cell,
    instead of a single scalar. Prefer the grid when the user has not fixed an ERP.

## Reading the response

- **`cost_of_equity`** = `rf_rate` + `beta_market` × `erp` (CAPM). Because
  `beta_market` is a short-half-life conditional beta, for defensive names
  `cost_of_equity` can fall below the risk-free rate — that is a property of the
  conditional beta, not an error. State it plainly rather than "correcting" it.
- **`wacc`** uses **book-value** weights (balance-sheet equity and debt). The
  textbook convention is market-value weights; say so, and note the user can reweight
  if they have market caps.
- **`economic_profit`** scales with book equity; pair it with `roe_ttm − cost_of_equity`
  (the equity-charge spread) when comparing across market caps.
- A short `rf_tenor` (3m/1y) should be paired with a bill-basis ERP, or cost of
  capital is understated. Surface the tenor you used.

## Boundary

These are model outputs from realized fundamentals and caller-supplied assumptions —
not a valuation opinion, price target, or recommendation. You are an analyst, not an
investment adviser. Always state the ERP, tenor, and tax rate behind any number, and
call the tool before quoting figures.

## Example prompts

- `/cost-of-capital AAPL 0.05 10y`
- "What's MSFT's WACC at a 4.5% and 5.5% ERP across the 5y and 10y risk-free?"
  (use the grid)
- "Show NVDA's cost of equity and economic profit; I'll use a 5% ERP."
