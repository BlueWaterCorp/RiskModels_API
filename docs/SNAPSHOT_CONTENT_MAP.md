# Snapshot Content Map — JSON-First Architecture

> How a world-class consulting firm would spec eight 1-page institutional PDFs.
> Every snapshot follows the same pipeline:
>
> ```
> fetch(ticker, client) → {ticker}_R1.json → render(json) → PDF
> ```
>
> The JSON is the **handshake contract**. An agent (or human) can improve any
> chart or narrative block by editing only the renderer — the JSON file + render
> code is a self-contained unit that needs zero API access.

---

## Shared Page Anatomy (all 8 pages)

Every PDF is **Letter Landscape (11 × 8.5 in)** with this skeleton:

```
┌─────────────────────────────────────────────────────────┐
│  HEADER BAR  ·  Ticker  ·  Company  ·  Report Label     │
├─────────────────────────────────────────────────────────┤
│  CHIP ROW   [ KPI 1 ]  [ KPI 2 ]  [ KPI 3 ]  ...      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            VISUAL PANELS  (charts / tables)              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  AI NARRATIVE  ·  2–3 sentence insight paragraph         │
├─────────────────────────────────────────────────────────┤
│  FOOTER  ·  Confidential  ·  Data TEO  ·  SDK version   │
└─────────────────────────────────────────────────────────┘
```

### AI Narrative Block

Every page includes a **2–3 sentence analyst narrative** generated from the
data. Think McKinsey exhibit footnote — not a wall of text, but the "so what"
a PM reads first. The narrative is computed during `get_data`, stored as a
string in the JSON, and rendered as a styled text block above the footer.

Template for narrative generation:

```
Given {ticker} metrics and {peer/benchmark} context:
  1. State the headline finding (strongest signal in the data)
  2. Quantify the edge or risk (cite the number)
  3. Frame the implication for a portfolio manager
```

---

## JSON Envelope (shared across all snapshots)

```json
{
  "schema_version": "1.0",
  "snapshot_type": "R1",
  "generated_utc": "2026-04-06T14:30:00Z",
  "sdk_version": "0.3.0",

  "identity": {
    "ticker": "NVDA",
    "company_name": "NVIDIA Corporation",
    "sector_etf": "XLK",
    "subsector_etf": "SMH",
    "universe": "uni_mc_3000",
    "teo": "2026-04-04"
  },

  "chips": [ ... ],
  "panels": { ... },
  "narrative": "NVDA's residual alpha is +42 bps above ...",
  "tables": { ... }
}
```

---

## RISK SNAPSHOTS (R1 – R4)

### R1 — Factor Risk Profile
**Current × Stock** · "Where is this stock's risk coming from right now?"

```
HEADLINE:    "NVDA — Factor Risk Profile"
QUESTION:    What % of this stock's risk is market, sector, subsector, residual?

CHIPS:
  L3 Mkt HR  |  L3 Sec HR  |  L3 Sub HR  |  Vol 23d  |  Selection Spread vs {subsector}

PANELS:
  ┌──────────────────────┬──────────────────────┐
  │  LEFT: L3 ER Decomp  │  RIGHT: HR Cascade   │
  │                       │                       │
  │  Horizontal stacked   │  Grouped bar:         │
  │  bar — 4 layers:      │  L1 → L2 → L3        │
  │  Market / Sector /    │  showing how hedge    │
  │  Subsector / Residual │  ratios refine by level │
  │  (% of total ER)      │  (convergence story)  │
  ├───────────────────────┴───────────────────────┤
  │  BOTTOM: Peer Comparison Table                 │
  │                                                │
  │  Ticker | Cap Wt% | Vol | L3 Res ER | vs Avg  │
  │  ★ NVDA |   —     | .42 |  +0.42%   | +11 bps │
  │  AMD    | 18.2%   | .38 |  +0.31%   |  +0 bps │
  │  ...                                           │
  └────────────────────────────────────────────────┘

NARRATIVE (auto-generated):
  "{ticker}'s L3 residual ER of {res_er}% places it {above/below} the
   {subsector_etf} peer average by {spread} bps. The dominant risk
   driver is {largest_factor} ({pct}% of total explained variance),
   suggesting {implication}."

JSON.panels:
  l3_er_bars:     { market: 0.12, sector: 0.05, subsector: 0.03, residual: 0.08 }
  hr_cascade:     { l1: {mkt: 1.32}, l2: {mkt: 1.28, sec: 0.94}, l3: {mkt: 1.25, sec: 0.91, sub: 0.87} }
  peer_table:     [ {ticker, weight, vol_23d, l3_residual_er, vs_peer_avg, l3_market_hr}, ... ]
```

**Data sources:** `GET /metrics/{ticker}`, `PeerGroupProxy.compare()`

---

### R2 — Risk Attribution Drift
**History × Stock** · "How has this stock's risk profile changed over time?"

```
HEADLINE:    "NVDA — Risk Attribution Drift"
QUESTION:    Are the factor exposures stable, trending, or regime-shifting?

CHIPS:
  L3 Mkt HR (latest)  |  L3 Sec HR  |  L3 Sub HR  |  Cumul α  |  Vol 23d

PANELS:
  ┌──────────────────────┬──────────────────────┐
  │  LEFT: ER Stacked    │  RIGHT: HR Time      │
  │  Area                │  Series              │
  │                       │                       │
  │  Daily L3 ER bands   │  Three lines:         │
  │  (Market blue,       │  L3 Mkt / Sec / Sub   │
  │  Sector teal,        │  hedge ratios over    │
  │  Subsector slate,    │  trailing window —   │
  │  Residual green)     │  converging or        │
  │  stacked over time   │  diverging?           │
  ├───────────────────────┴───────────────────────┤
  │  BOTTOM: Cumulative ER Waterfall               │
  │                                                │
  │  Bar chart: total cumulative contribution of   │
  │  each factor over the window                   │
  │  Market: +8.2% | Sector: +1.4% | Sub: -0.3%  │
  │  Residual (α): +4.1%                          │
  └────────────────────────────────────────────────┘

NARRATIVE:
  "Over the trailing {months} months, {ticker}'s factor profile has
   {stabilised / shifted}. L3 market HR averaged {avg_mkt_hr} (range
   {min}–{max}), while residual alpha accumulated {cumul_alpha}%,
   {ranking} among {subsector_etf} peers."

JSON.panels:
  er_stacked_area:  [ {date, market_er, sector_er, subsector_er, residual_er}, ... ]
  hr_time_series:   [ {date, l3_market_hr, l3_sector_hr, l3_subsector_hr}, ... ]
  cumulative_er:    { market: 8.2, sector: 1.4, subsector: -0.3, residual: 4.1 }
```

**Data sources:** `GET /ticker-returns` (daily L3 columns), `GET /metrics/{ticker}`

---

### R3 — Concentration Mekko
**Current × Portfolio** · "Where is the portfolio's risk concentrated right now?"

```
HEADLINE:    "Portfolio — Risk Concentration"
QUESTION:    Which positions and factors dominate portfolio risk?

CHIPS:
  Portfolio Vol  |  Top-5 Conc%  |  Herfindahl  |  # Positions  |  Eff. N

PANELS:
  ┌──────────────────────────────────────────────┐
  │  TOP: Mekko / Marimekko Chart                 │
  │                                                │
  │  X-axis = position weight                      │
  │  Y-axis = L3 factor stack (Mkt/Sec/Sub/Res)   │
  │  Width of each column = portfolio weight       │
  │  Height of each band = contribution to risk    │
  │  Color = factor layer (navy/teal/slate/green)  │
  │                                                │
  │  → Reader instantly sees: "NVDA is 8% of the  │
  │     portfolio but 22% of total risk, mostly    │
  │     residual (green band is huge)"             │
  ├────────────────────────────────────────────────┤
  │  BOTTOM: Risk Contribution Table               │
  │                                                │
  │  Ticker | Wt% | Marg Var | Risk Cont% | L3 α  │
  │  (sorted by risk contribution, top 10)         │
  └────────────────────────────────────────────────┘

NARRATIVE:
  "The portfolio's risk is {concentrated / diversified} — the top
   {n} positions contribute {pct}% of total variance. {top_ticker}
   is the dominant risk source at {risk_cont}%, driven primarily by
   {factor}. Effective N of {eff_n} suggests {implication}."

JSON.panels:
  mekko:           [ {ticker, weight, mkt_risk_cont, sec_risk_cont, sub_risk_cont, res_risk_cont}, ... ]
  risk_table:      [ {ticker, weight_pct, marginal_var, risk_contribution_pct, l3_residual_er}, ... ]
  portfolio_stats: { total_vol, herfindahl, effective_n, top5_concentration }
```

**Data sources:** `POST /batch/analyze` (portfolio mode), `PeerGroupProxy` for each position

---

### R4 — Style Drift
**History × Portfolio** · "Has the portfolio's factor tilt changed over time?"

```
HEADLINE:    "Portfolio — Style Drift"
QUESTION:    Are we drifting toward more market/sector/residual risk over time?

CHIPS:
  Avg Mkt HR  |  HR range  |  Sector Tilt Δ  |  Residual Share (now vs 6m ago)

PANELS:
  ┌──────────────────────────────────────────────┐
  │  TOP: Stacked Area — Portfolio Factor Mix      │
  │                                                │
  │  Like R2 but at portfolio level:               │
  │  daily aggregate L3 ER decomposition           │
  │  showing how the mix of market / sector /      │
  │  subsector / residual has shifted               │
  ├──────────────────────┬─────────────────────────┤
  │  BOTTOM LEFT:        │  BOTTOM RIGHT:           │
  │  Rolling portfolio   │  Sector Allocation       │
  │  L3 market HR (21d   │  Drift                   │
  │  average). Informal  │  100% stacked bar by     │
  │  market-beta read —  │  month: what % of risk   │
  │  is PM more/less     │  came from each GICS     │
  │  levered to market?  │  sector over time?       │
  └──────────────────────┴─────────────────────────┘

NARRATIVE:
  "Over the trailing {months} months, portfolio L3 market HR has
   {increased/decreased} from {start} to {end}. Residual risk share
   moved from {old}% to {new}%, indicating {more/less} active stock
   selection. Sector allocation shifted {toward/away from} {sector}."

JSON.panels:
  portfolio_factor_area: [ {date, mkt_er, sec_er, sub_er, res_er}, ... ]
  rolling_portfolio_beta: [ {date, portfolio_mkt_hr_21d}, ... ]
  sector_drift:          [ {month, sector_weights: {XLK: 0.32, XLF: 0.18, ...}}, ... ]
```

**Data sources:** `POST /batch/analyze` (time-series mode), daily rebalanced weights

---

## PERFORMANCE SNAPSHOTS (P1 – P4)

### P1 — Return & Relative Performance
**Current × Stock** · "How is this stock performing vs its benchmarks right now?"

```
HEADLINE:    "NVDA — Return & Relative Performance"
QUESTION:    Is this stock outperforming its sector, subsector, and market?

CHIPS:
  1d Return  |  5d  |  1m  |  3m  |  1y  |  vs SPY (1m)  |  vs {subsector} (1m)

PANELS:
  ┌──────────────────────┬──────────────────────┐
  │  LEFT: Trailing      │  RIGHT: Bullet       │
  │  Return Bars         │  Gauges              │
  │                       │                       │
  │  Grouped bar chart:  │  3 bullet charts:     │
  │  1d / 5d / 1m / 3m  │  Stock return vs.     │
  │  / 1y — one cluster  │  SPY / Sector ETF /  │
  │  per window, bars    │  Subsector ETF        │
  │  for Stock / Sector  │  with range bands     │
  │  / Subsector / SPY   │  (peer min/max)       │
  ├───────────────────────┴───────────────────────┤
  │  BOTTOM: Relative Return Heatmap               │
  │                                                │
  │  Matrix: rows = windows (1d..1y)               │
  │  cols = benchmarks (SPY, Sector, Subsector)    │
  │  cells colored green (outperform) /            │
  │  orange (underperform) with bps values         │
  └────────────────────────────────────────────────┘

NARRATIVE:
  "{ticker} has returned {1m_ret}% over the past month, {outperforming/
   underperforming} {subsector_etf} by {spread} bps. Relative strength
   is {improving/deteriorating} across horizons, with the {window}
   signal being the {strongest/weakest}."

JSON.panels:
  trailing_returns:  { stock: {1d, 5d, 1m, 3m, 1y}, spy: {...}, sector: {...}, subsector: {...} }
  bullet_gauges:     [ {benchmark, stock_val, bench_val, peer_range: [min, max]}, ... ]
  relative_heatmap:  { rows: [1d, 5d, 1m, 3m, 1y], cols: [SPY, sector, subsector], values: [[...]] }
```

**Data sources:** `fetch_stock_context()` → `trailing_returns()`, `relative_returns()`

---

### P2 — Cumulative Performance
**History × Stock** · "What's the equity curve story over time?"

```
HEADLINE:    "NVDA — Cumulative Performance"
QUESTION:    How has total return evolved, and how deep were the drawdowns?

CHIPS:
  Total Return  |  Max Drawdown  |  Sharpe (rolling 63d)  |  Best Month  |  Worst Month

PANELS:
  ┌──────────────────────────────────────────────┐
  │  TOP: Cumulative Return Lines                  │
  │                                                │
  │  Multi-line chart:                             │
  │  Stock / SPY / Sector ETF / Subsector ETF      │
  │  all rebased to 0 at start of window           │
  │  (classic hedge fund factsheet exhibit)        │
  ├──────────────────────┬─────────────────────────┤
  │  BOTTOM LEFT:        │  BOTTOM RIGHT:           │
  │  Drawdown Underwater │  Rolling Sharpe          │
  │                       │                           │
  │  Filled area chart   │  63-day rolling Sharpe    │
  │  (always ≤ 0) —      │  for stock vs SPY —       │
  │  shows depth and     │  are risk-adjusted        │
  │  duration of every   │  returns trending up      │
  │  drawdown episode    │  or down?                 │
  └──────────────────────┴─────────────────────────┘

NARRATIVE:
  "{ticker} returned {total_ret}% over {months} months vs {spy_ret}%
   for SPY. The maximum drawdown was {max_dd}%, lasting {dd_days}
   trading days. Rolling Sharpe is currently {sharpe}, {above/below}
   its trailing average of {avg_sharpe}."

JSON.panels:
  cumulative_lines: { stock: [{date, cum_ret}], spy: [...], sector: [...], subsector: [...] }
  drawdown:         [ {date, drawdown_pct}, ... ]
  rolling_sharpe:   [ {date, stock_sharpe, spy_sharpe}, ... ]
  summary_stats:    { total_return, max_drawdown, max_dd_days, current_sharpe, avg_sharpe }
```

**Data sources:** `fetch_stock_context()` → `cumulative_returns()`, `max_drawdown_series()`, `rolling_sharpe()`

---

### P3 — Return Contribution
**Current × Portfolio** · "Which positions drove portfolio return recently?"

```
HEADLINE:    "Portfolio — Return Contribution"
QUESTION:    Who made us money and who cost us?

CHIPS:
  Portfolio 1m Ret  |  Top Contributor  |  Worst Detractor  |  Hit Rate  |  # Positions

PANELS:
  ┌──────────────────────────────────────────────┐
  │  TOP: Waterfall Chart                          │
  │                                                │
  │  Classic attribution waterfall:                │
  │  Start at 0 → each position adds/subtracts    │
  │  → lands at portfolio total return             │
  │  Bars colored green (gain) / orange (loss)     │
  │  Width proportional to weight                  │
  │  Top-10 individually, rest bucketed as "Other" │
  ├──────────────────────┬─────────────────────────┤
  │  BOTTOM LEFT:        │  BOTTOM RIGHT:           │
  │  Contribution Table  │  Hit-Rate Donut          │
  │                       │                           │
  │  Ticker | Wt% |      │  Simple donut: % of       │
  │  Return | Cont bps   │  positions with positive   │
  │  (sorted by cont,    │  return vs negative,       │
  │  top 10 + "Other")   │  with count labels         │
  └──────────────────────┴─────────────────────────┘

NARRATIVE:
  "The portfolio returned {port_ret}% over the past month. {top_ticker}
   was the largest contributor at {cont} bps ({weight}% weight ×
   {ret}% return). {n_pos} of {total} positions were profitable
   (hit rate {hit_rate}%)."

JSON.panels:
  waterfall:      [ {ticker, weight, return_1m, contribution_bps, running_total}, ... ]
  contribution_table: [ {ticker, weight_pct, return_1m, contribution_bps}, ... ]
  hit_rate:       { positive: 18, negative: 7, total: 25 }
  portfolio_summary: { portfolio_return_1m, top_contributor, worst_detractor }
```

**Data sources:** `POST /batch/analyze` (portfolio mode), position weights × returns

---

### P4 — Portfolio vs Benchmark
**History × Portfolio** · "Is the portfolio beating its benchmark over time?"

```
HEADLINE:    "Portfolio — Performance vs Benchmark"
QUESTION:    What's the alpha trend and where did it come from?

CHIPS:
  Portfolio YTD  |  Benchmark YTD  |  Active Return  |  Info Ratio  |  Tracking Error

PANELS:
  ┌──────────────────────────────────────────────┐
  │  TOP: Cumulative Return — Portfolio vs Bench   │
  │                                                │
  │  Two lines: portfolio and benchmark, rebased   │
  │  Shaded area between = active return           │
  │  (green when above, orange when below)         │
  ├──────────────────────┬─────────────────────────┤
  │  BOTTOM LEFT:        │  BOTTOM RIGHT:           │
  │  Monthly Active      │  Rolling Info Ratio      │
  │  Return Bars         │                           │
  │                       │  63-day rolling IR line  │
  │  Bar chart: monthly  │  with zero reference     │
  │  portfolio - bench   │  line — is skill          │
  │  return (green/      │  persistent or noisy?    │
  │  orange by sign)     │                           │
  └──────────────────────┴─────────────────────────┘

NARRATIVE:
  "The portfolio has {outperformed/underperformed} {benchmark} by
   {active_ret}% over {months} months (annualised IR: {ir}). Active
   return was positive in {pos_months} of {total_months} months.
   Tracking error of {te}% implies {concentrated/diversified} active
   bets."

JSON.panels:
  cumulative_vs_bench: { portfolio: [{date, cum_ret}], benchmark: [{date, cum_ret}] }
  monthly_active:      [ {month, active_return_pct}, ... ]
  rolling_ir:          [ {date, info_ratio_63d}, ... ]
  summary_stats:       { active_return, info_ratio, tracking_error, positive_months, total_months }
```

**Data sources:** `POST /batch/analyze` (time-series), benchmark returns, portfolio weights history

---

## Implementation Priority

```
Phase 1 (now):   JSON serialization for S1 + S2 (proves the pipeline)
Phase 2:         R1 = S1 rebuilt on SnapshotPage + narrative block
                 P1 = first performance page (uses fetch_stock_context)
                 P2 = equity curve (all helpers already exist in _data.py)
Phase 3:         R2 = S2 rebuilt on SnapshotPage + narrative
Phase 4:         R3, P3 = portfolio pages (need batch/portfolio mode)
Phase 5:         R4, P4 = portfolio history (heaviest data lift)
```

---

*Generated by RiskModels SDK · Consultant Navy Design System*
