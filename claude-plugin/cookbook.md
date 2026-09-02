# Cookbook — one name, end to end

A single worked flow that chains the plugin's skills the way the **riskmodels-analyst**
agent runs them: **fundamentals → cost of capital → risk decomposition → hedge → residual
signal.** Every step is a live tool call against the hosted RiskModels MCP; nothing here
is computed locally, and no figure is invented. The concrete numbers shown are a live
snapshot (NVDA, `data_as_of 2026-07-09`) — run it yourself and you will get the current
values.

Prerequisite: `export RISKMODELS_API_KEY=...` (see the README). Then either drive the
steps with the individual skills, or ask the `riskmodels-analyst` agent the whole question
and let it fan the calls out.

---

## Step 1 — Point-in-time fundamentals

> `/fundamentals-pit NVDA`

Calls `riskmodels_get_fundamentals` (`ticker=NVDA`, default `as_of=today`). Returns
quarterly rows visible only where `filed_date <= as_of` — so the same query dated in the
past reflects exactly what had been filed by then. Each row carries TTM ratios
(`roe_ttm`, `fcf_margin`, …), the capital-return set (`payout_ratio`, `retention_ratio`,
`buyback_ratio`, `total_payout_ratio`, `sustainable_growth`), the ERM3 cascade betas, an
`equity_bridge_residual` + `equity_bridge_inputs` mask, and **`sec_facts`** — raw line
items as `{value, source}` per cell **where the serving value is SEC XBRL** (`us_gaap`/
`ifrs`); cells that are not SEC-sourced are absent, so this is not a "raw fundamentals"
panel — it is raw where SEC-sourced and derived elsewhere.

*Anti-look-ahead is the point:* `/fundamentals-pit NVDA 2023-06-30` gives you the book as
it stood mid-2023, no restatement, no peeking.

## Step 2 — Cost of capital (CAPM)

> `/cost-of-capital NVDA 0.05 10y`

Same tool, now reading the cost-of-capital layer with a **caller-supplied** equity risk
premium (`erp=0.05`) and risk-free tenor (`rf_tenor=10y`). Returns `cost_of_equity`
(= `rf_rate` + `beta_market` × `erp`), book-weight `wacc`, and `economic_profit`. The ERP
is never assumed — state it in the answer, or pass `grid=true` with `erp_grid` /
`rf_tenor_grid` for the full ERP × tenor sensitivity table. Because `beta_market` is a
short-half-life conditional beta, a defensive name's `cost_of_equity` can sit below the
risk-free rate — a property of the beta, not an error.

## Step 3 — Risk decomposition (L1/L2/L3 cascade)

> `/risk-decompose NVDA`

Calls `riskmodels_get_hedge_levels` (and/or `get_metrics`). The cascade deepens
market-only → +sector → +subsector. Live snapshot:

| Level | market ER | sector ER | subsector ER | residual ER | ETF legs |
| --- | --- | --- | --- | --- | --- |
| L1 | 0.42 | — | — | 0.58 | SPY |
| L2 | 0.42 | 0.13 | — | 0.45 | SPY, XLK |
| L3 | 0.42 | 0.13 | −0.01 | 0.46 | SPY, XLK, SMH |

Read the `*_er` fractions (they sum to ~1.0 at L3), not the hedge-ratio signs, to say
where variance lives: ~42% market, ~13% sector, and ~46% **stock-specific** at L3 — much
of NVDA's risk is idiosyncratic and not hedgeable with ETFs.

## Step 4 — Hedge legs

> `/portfolio-hedge NVDA:1.0`

Calls `riskmodels_hedge_position` / `riskmodels_hedge_portfolio` to scale the L3 ETF hedge
ratios to a dollar position. Report each leg as what it **would mechanically neutralize**,
e.g. "$0.94 of SPY per $1 of position neutralizes the market leg" (live `l3_mkt_hr` ≈
−0.94), with the XLK and SMH legs alongside. The negative market ratio is **not** "short
the market": at L3 the XLK/SMH legs already carry market beta, and the SPY leg offsets
what is embedded in them (orthogonalization). It is a model output, like a beta — reporting
it is reporting the math, not a trade recommendation.

## Step 5 — Residual signal

> `/residual-screen NVDA`  (or a basket: `NVDA AMD AVGO MU`)

Calls `riskmodels_get_rankings` for where NVDA sits in its sector/universe, and
`riskmodels_get_residual_signal` for the aggregate L3 residual mean-reversion signal on a
basket — built on exactly the idiosyncratic return Step 3 isolated. This is a realized
statistical signal describing the residual, not a price forecast.

---

## The whole thing, one prompt

Ask the agent instead of running the steps by hand:

> "Give me the full RiskModels read on NVDA: point-in-time fundamentals and CAPM WACC at a
> 5% ERP, the L3 risk decomposition, what an ETF hedge of each leg would neutralize, and
> where it ranks on residual risk."

`riskmodels-analyst` fans the independent calls out in one turn, leads with the one-line
answer, and drops the per-leg tables into a collapsible block.

## Boundary (applies to every step)

RiskModels is an analytical tool, not an investment adviser. These are model outputs from
realized data and caller-supplied assumptions — decomposition, hedge ratios, ranks, and
signals — **not** recommendations, price targets, or suitability assessments. No forecasts.
Always let the tools produce the numbers; never fill them in from memory.
