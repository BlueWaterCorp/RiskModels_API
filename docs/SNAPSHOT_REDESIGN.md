# Snapshot Suite Redesign — McKinsey-Level Single-Page PDFs

> Replaces the current HTML/WeasyPrint approach with pure Matplotlib figures.
> Each snapshot is one 11×8.5 landscape page, zero whitespace.

## Why the current approach fails

The S1/S2 PDFs render as multi-page documents with 60%+ blank space because:

1. **HTML is a flow layout** — it doesn't know page boundaries. WeasyPrint paginates
   where the content overflows, creating orphan pages.
2. **Charts are fixed-size PNGs** embedded in responsive HTML. The HTML grid can't
   size them to fill the page.
3. **No page-aware layout** — there's no mechanism to say "this panel gets 40% of
   the page height."

## New architecture: one Matplotlib figure = one page

```
fig = plt.figure(figsize=(11, 8.5))   # landscape letter
gs  = fig.add_gridspec(rows, cols, ...)  # precise fractional layout
ax_header = fig.add_subplot(gs[0, :])    # header strip
ax_chart1 = fig.add_subplot(gs[1, 0])    # top-left chart
...
fig.savefig("out.pdf", dpi=300)          # one page, pixel-perfect
```

**Why this works:**
- Figure size IS the page size. No pagination.
- GridSpec gives fractional control: "this panel gets rows 1-2, columns 0-1"
- Header, chips, charts, tables, footer are all subplots/annotations in one coordinate system
- `fig.savefig()` produces a single-page PDF directly — no HTML rendering step
- This is how Goldman Sachs GSAM, Bloomberg PORT, and McKinsey build programmatic reports

**Dependencies reduced:** Drop WeasyPrint + Jinja2. Only need Matplotlib (already required).

---

## Two suites × four quadrants = 8 snapshot pages

| Quadrant | Risk Suite (Rn) | Performance Suite (Pn) |
|:---------|:-----------------|:-----------------------|
| Current × Stock | **R1** Factor Risk Profile | **P1** Return + Relative Performance |
| History × Stock | **R2** Risk Attribution Drift | **P2** Cumulative Performance + Drawdown |
| Current × Portfolio | **R3** Concentration Mekko | **P3** Return Contribution |
| History × Portfolio | **R4** Style Drift | **P4** Portfolio Performance vs Benchmark |

---

## Page layouts (landscape 11 × 8.5 in)

All pages share a common structure:

```
┌─────────────────────────────────────────────────┐  ← 0.0"
│  HEADER: Ticker · Company · TEO · Confidential  │  ← 0.5"
│  CHIPS: 8-10 key metrics in a row                │  ← 1.0"
├────────────────────┬────────────────────────────┤
│                    │                            │
│   PANEL A          │   PANEL B                  │  ← 1.0"–4.5"
│   (chart/table)    │   (chart/table)            │
│                    │                            │
├────────────────────┼────────────────────────────┤
│                    │                            │
│   PANEL C          │   PANEL D                  │  ← 4.5"–7.8"
│   (chart/table)    │   (chart/table)            │
│                    │                            │
├────────────────────┴────────────────────────────┤
│  FOOTER: ERM3 V3 · riskmodels-py · disclaimer   │  ← 8.0"–8.5"
└─────────────────────────────────────────────────┘
```

Standard GridSpec: 12 rows × 12 cols. Header=row 0, chips=row 1,
panels=rows 2-11, footer=text annotation at y=0.02.

### R1 — Current × Stock Risk Profile

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top-left) | L3 ER decomposition: Market / Sector / Sub / Residual | Horizontal bar |
| B (top-right) | L1→L2→L3 hedge-ratio cascade | Grouped vertical bar |
| C (bottom-left) | Volatility context: 23d vol vs 63d vs 252d, with sector/sub percentile | Bullet/gauge |
| D (bottom-right) | Peer comparison table: target vs top-8 peers by cap-weight | Matplotlib table |

### R2 — History × Stock Risk Drift

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top-left) | L3 ER attribution over trailing 1Y (stacked area) | Stacked area |
| B (top-right) | Hedge ratio drift: Mkt β / Sec β / Sub β lines | Multi-line |
| C (bottom-left) | Rolling 63d realised vol with 252d baseline | Line + fill |
| D (bottom-right) | Cumulative ER by factor (trailing period totals) | Vertical bar |

### R3 — Current × Portfolio Concentration Mekko

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top, 2/3 height) | Mekko: column width = weight, stacked height = ER attribution | Variable-width stacked bar |
| B (bottom, 1/3 height) | Position risk table: ticker, weight, Mkt β, vol, Mkt ER, Res ER, HHI | Matplotlib table |

### R4 — History × Portfolio Style Drift

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top-left) | Rolling portfolio market beta (63d trailing) | Line + confidence band |
| B (top-right) | Vol contribution by position over time (stacked area) | Stacked area |
| C (bottom, full) | Factor exposure heatmap: Mkt/Sec/Sub β at quarterly snapshots | Heatmap/table |

### P1 — Current × Stock Performance + Relative

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top-left) | Trailing returns: 1d / 5d / 21d / 63d / 252d (absolute) | Horizontal bar |
| B (top-right) | Relative returns: same windows, vs sector ETF / subsector ETF / SPY | Grouped horizontal bar |
| C (bottom-left) | 63d return distribution with current position annotated | Histogram + marker |
| D (bottom-right) | Stats table: ann. return, Sharpe, Sortino, max DD, tracking error | Matplotlib table |

### P2 — History × Stock Cumulative Performance

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top, 55%) | Cumulative return: stock vs sector ETF vs SPY (indexed to 100) | Multi-line with fill |
| B (middle, 25%) | Underwater equity curve (drawdown %) | Negative fill area |
| C (bottom-left, 20%) | Rolling 63d Sharpe ratio | Line |
| D (bottom-right, 20%) | Monthly return heatmap (year × month grid, colour-coded) | Heatmap |

### P3 — Current × Portfolio Return Contribution

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top, 55%) | Weighted return contribution by position (horizontal waterfall) | Waterfall bar |
| B (bottom-left) | Portfolio vs benchmark return (1d/5d/21d/63d/252d) | Grouped bar |
| C (bottom-right) | Top-5 / bottom-5 movers table | Styled table |

### P4 — History × Portfolio Performance vs Benchmark

| Panel | Content | Chart type |
|:------|:--------|:-----------|
| A (top, 55%) | Cumulative portfolio return vs benchmark (indexed to 100) | Multi-line |
| B (middle, 25%) | Rolling excess return (portfolio − benchmark) | Line + zero axis |
| C (bottom, 20%) | Return concentration trend: HHI of weighted returns over time | Line |

---

## Shared rendering engine

```
sdk/riskmodels/snapshots/
  _page.py          # SnapshotPage class: creates fig, gridspec, header, footer, chips
  _charts.py        # Reusable chart primitives: hbar, vbar, stacked_area, line, table, heatmap, mekko
  _theme.py         # Consultant Navy colours, fonts, line widths — single source of truth
  r1_risk_profile.py
  r2_risk_drift.py
  r3_concentration.py
  r4_style_drift.py
  p1_performance.py
  p2_cumulative.py
  p3_contribution.py
  p4_portfolio_perf.py
  __init__.py
```

### `SnapshotPage` — the layout engine

```python
class SnapshotPage:
    """One 11×8.5 landscape page with standard header/footer."""

    def __init__(self, title, subtitle, ticker, teo, chips, *,
                 grid_rows=12, grid_cols=12):
        self.fig = plt.figure(figsize=(11, 8.5))
        self.gs = self.fig.add_gridspec(
            grid_rows, grid_cols,
            left=0.05, right=0.95, top=0.92, bottom=0.04,
            hspace=0.3, wspace=0.25,
        )
        self._render_header(title, subtitle, ticker, teo)
        self._render_chips(chips)
        self._render_footer()

    def panel(self, row_slice, col_slice):
        """Get an Axes for a grid region. e.g. page.panel(slice(2,6), slice(0,6))"""
        return self.fig.add_subplot(self.gs[row_slice, col_slice])

    def save(self, path):
        self.fig.savefig(path, dpi=300, bbox_inches='tight', pad_inches=0.1)
        plt.close(self.fig)
```

### `_charts.py` — reusable chart primitives

Each function takes an `ax` (Axes) and data, applies Consultant Navy styling:

- `chart_hbar(ax, labels, values, colors)` — horizontal bar (for ER decomp)
- `chart_grouped_vbar(ax, groups, ...)` — grouped vertical bar (for HR cascade)
- `chart_stacked_area(ax, dates, series, ...)` — stacked area (for ER history)
- `chart_multi_line(ax, dates, lines, ...)` — multi-line (for HR drift, cum return)
- `chart_waterfall(ax, labels, values, ...)` — step waterfall (for return attribution)
- `chart_mekko(ax, tickers, weights, er_components)` — variable-width stacked bar
- `chart_heatmap(ax, data, xlabels, ylabels, ...)` — colour-coded grid
- `chart_table(ax, rows, headers, ...)` — styled Matplotlib table
- `chart_histogram(ax, values, ...)` — return distribution

---

## Data requirements by page

| Page | API calls | Computed locally |
|:-----|:----------|:-----------------|
| R1 | `get_metrics`, PeerGroupProxy | — |
| R2 | `get_ticker_returns(years=1)` | — |
| R3 | `batch_analyze(positions, ["full_metrics"])` | HHI, cap-weights |
| R4 | `batch_analyze(positions, ["returns"])` | Rolling β, vol contribution |
| P1 | `get_ticker_returns(years=1)`, `get_etf_returns(sector)`, `get_etf_returns("SPY")` | Trailing return windows, relative returns |
| P2 | `get_ticker_returns(years=3)`, `get_etf_returns(sector, 3)`, `get_etf_returns("SPY", 3)` | Cumulative, drawdown, rolling Sharpe, monthly grid |
| P3 | `batch_analyze(positions, ["full_metrics", "returns"])` | Weighted contribution |
| P4 | `batch_analyze(positions, ["returns"])`, `get_etf_returns("SPY")` | Cum portfolio return, rolling excess |

---

## Implementation phases

### Phase A: Rendering engine (2 sessions)
1. `_theme.py` — colours, fonts, standard sizes
2. `_page.py` — SnapshotPage with header/chips/footer
3. `_charts.py` — 8 chart primitives
4. Test: generate a blank page with header + 4 empty panels → verify single-page PDF

### Phase B: Risk suite (2 sessions)
1. R1 + R2 (stock-level, uses existing data endpoints)
2. R3 + R4 (portfolio-level, needs batch_analyze integration)

### Phase C: Performance suite (2 sessions)
1. P1 + P2 (stock-level, add ETF returns for relative performance)
2. P3 + P4 (portfolio-level)

### Phase D: Polish + combined output (1 session)
1. Multi-page PDF combiner: `generate_full_report(ticker, positions)` → 8-page PDF
2. Font fine-tuning, label placement, colour calibration
3. Edge case handling (missing data, short histories, no peers)

---

## Design standards (Consultant Navy)

| Element | Spec |
|:--------|:-----|
| Primary | `#002a5e` (Navy) — titles, Market factor |
| Secondary | `#006f8e` (Teal) — Sector factor |
| Tertiary | `#2a7fbf` (Slate) — Subsector factor |
| Alpha | `#00AA00` (Green) — Residual / alpha |
| Warning | `#E07000` (Orange) — gross return line, highlights |
| Background | `#f5f7fb` (Light) — figure background |
| Panel bg | `#ffffff` — chart area background |
| Grid | `#e2e8f0`, linewidth 0.4, dashed |
| Font | Arial / Helvetica, 8pt body, 11pt panel titles, 14pt page title |
| Header | 3px Navy bottom border |
| Footer | 0.5px gray top border, 7pt gray text |
| Chips | `#eef2f7` background, 10pt Navy value, 7pt gray label |

---

## What gets deleted

- `sdk/riskmodels/snapshots/_base_template.py` — HTML template (replaced by `_page.py`)
- `sdk/riskmodels/snapshots/s1_forensic.py` — current S1 (replaced by `r1_risk_profile.py`)
- `sdk/riskmodels/snapshots/s2_waterfall.py` — current S2 (replaced by `r2_risk_drift.py`)
- WeasyPrint + Jinja2 as dependencies (Matplotlib is the only renderer)

---

## Open question: deploy `/api/tickers` metadata fix

R1 peer comparison and R3/R4 portfolio views need `subsector_etf` from the tickers
endpoint. The `route.ts` fix exists locally but hasn't been deployed. This should be
deployed to Vercel before R1 can show peer context.
