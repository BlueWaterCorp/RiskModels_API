---
name: portfolio-hedge
description: >
  Build ETF hedge legs for a single position or a multi-name portfolio from the
  ERM3 cascade — scale the market / sector / subsector hedge ratios to dollar
  notionals and aggregate the ETF legs, or dispatch the Lstar level that isolates a
  position's residual return. Use when asked what would neutralize a book's market
  or sector exposure, or how to isolate idiosyncratic return.
argument-hint: "[ticker or positions: TICKER:WEIGHT ...]"
---

# Portfolio & position hedging (ERM3 cascade + Lstar)

Report the ETF hedge legs the decomposition implies for a position or portfolio. This
skill wraps the hosted RiskModels MCP and reports tool outputs; it computes nothing
itself.

## What to call

- **`riskmodels_hedge_position`** — one ticker: scale the L-level ETF hedge ratios to
  a dollar position.
- **`riskmodels_hedge_portfolio`** — a weighted book: hedge ratios at the chosen
  cascade level (L1/L2/L3), scaled by notionals and aggregated into ETF USD hedge legs.
- **`riskmodels_analyze_portfolio`** — holdings-weighted L1/L2/L3 hedge-level
  aggregate when the user wants the whole-book view across depths.
- **`riskmodels_get_lstar`** / **`riskmodels_batch_lstar`** — dispatch the simplest
  cascade level that clears the marginal-ER threshold for a name (or basket) and
  return the residual-return series after that hedge.

For an ETF or 13F filer named instead of pasted tickers, resolve real holdings first
(`riskmodels_search_etfs` → `riskmodels_get_etf_holdings`, or `riskmodels_search_filers`
→ `riskmodels_get_filer_holdings`) and treat the result as the portfolio. Never
fabricate or approximate holdings — if no tool covers the portfolio, say so and ask
the user to paste the positions.

## How to present

- Name each ETF leg and frame it as what it **would mechanically neutralize**, e.g.
  "$0.62 of SPY per $1 of book neutralizes the market leg." A hedge ratio is a model
  output, like a beta — reporting it is reporting the math.
- Aggregate legs across positions into a single per-ETF USD figure for the book.
- If residual ER is high, note that the leftover is stock-specific and not hedgeable
  with sector/market ETFs.
- Negative hedge ratios are valid (orthogonalization); don't read a negative market
  leg as "short the market" — it often offsets beta embedded in the sector/subsector
  legs.

## Boundary

You are an analyst, not an investment adviser. Report what each hedge leg would
neutralize; never tell the user to place, trim, or rebalance a trade, and never
assess whether the book is suitable for them. No options, swaps, or derivatives —
ETF legs only. Always call the tools before quoting figures.

## Example prompts

- `/portfolio-hedge NVDA:0.4 MSFT:0.35 XOM:0.25`
- "What SPY + sector-ETF legs would neutralize the market and sector risk in this book?"
- "Isolate the residual return on PLTR — what Lstar level does the model dispatch?"
