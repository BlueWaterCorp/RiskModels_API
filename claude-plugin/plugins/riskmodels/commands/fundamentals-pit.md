---
description: Point-in-time quarterly fundamentals — rows visible only where filed_date <= as_of
argument-hint: "<ticker e.g. AAPL> [as_of YYYY-MM-DD]"
---

# Fundamentals (PIT)

Pull point-in-time fundamentals for `$ARGUMENTS` using the **fundamentals-pit** skill.

1. Resolve the ticker if needed (`riskmodels_search_tickers`).
2. Call `riskmodels_get_fundamentals` with `ticker` and optional `as_of` / `periods`.
3. Report ratios, CAPM layer fields if present, and `sec_facts` only where SEC-sourced. Do not call the panel "raw fundamentals."

Realized/historical only — not investment advice. PIT-normalized fundamentals derived from SEC filings and licensed sources.
