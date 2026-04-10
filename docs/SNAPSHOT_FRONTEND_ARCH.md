# Snapshot Frontend Architecture

> Pure-Matplotlib rendering pipeline for institutional-grade PDF snapshots.
> No WeasyPrint, no HTML, no Jinja2.

---

## Design Philosophy

Every snapshot is a single-page **Letter Landscape** (11×8.5") PDF that a portfolio manager can print, email, or embed in a client deck. The design language is **Consultant Navy** — the same visual grammar used by McKinsey, BCG, and Bridgewater one-pagers: dark navy headers, muted data-ink, clear hierarchy, no chartjunk.

The rendering pipeline is built on one key insight: **Matplotlib's `GridSpec` is a layout engine, not just a chart tool.** By treating the entire page as a grid of panels, we get pixel-precise placement of charts, tables, and text — all in a single `.savefig()` call, all vector-resolution at 300 DPI.

---

## Core Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    DATA LAYER                            │
│  fetch_stock_context() → StockContext                    │
│  PeerGroupProxy.from_ticker() → PeerGroupProxy           │
│  proxy.compare() → PeerComparison                        │
├──────────────────────────────────────────────────────────┤
│                  JSON BOUNDARY                           │
│  R1Data.to_json() ──→ {envelope + data} ──→ .json file  │
│  R1Data.from_json() ←── reads .json, rebuilds dataclass │
├──────────────────────────────────────────────────────────┤
│                  RENDER LAYER                            │
│  render_r1_to_pdf(data, path) → .pdf                    │
│     ├─ SnapshotPage (layout engine)                     │
│     ├─ chart_hbar, chart_grouped_vbar, ... (primitives) │
│     └─ THEME (palette, typography, strokes)             │
└──────────────────────────────────────────────────────────┘
```

### Fetch / Render Separation

Every snapshot module exports exactly two public functions:

- **`get_data_for_XX(ticker, client)`** — makes all API calls, returns a frozen dataclass. This is the *slow* step that needs network access.
- **`render_XX_to_pdf(data, output_path)`** — consumes the dataclass, produces a PDF. This is the *fast* step that runs offline.

The **JSON file** is the handshake artifact between them. An agent (or human) can `fetch` once, then iterate on the render dozens of times without touching the API. This is critical for the agent workflow where Opus designs layouts and Sonnet iterates on styling — Sonnet never needs API credentials.

### JSON Envelope

```json
{
  "schema_version": "1.0",
  "snapshot_type": "r1_risk_profile",
  "generated_utc": "2026-04-07T14:30:00Z",
  "data": {
    "ticker": "NVDA",
    "company_name": "NVIDIA Corporation",
    "teo": "2026-04-06",
    "metrics": { ... },
    "peer_comparison": { ... },
    "narrative": "NVDA's L3 residual alpha ..."
  }
}
```

Every field in `data` maps 1:1 to the dataclass. DataFrames serialize as `records` format. NaN becomes `null`. Numpy scalars become Python floats.

---

## Layout Engine: `SnapshotPage`

`_page.py` implements the page-level layout:

```python
page = SnapshotPage(
    title="NVDA — NVIDIA Corporation",
    subtitle="R1 · Factor Risk Profile",
    ticker="NVDA",
    teo="2026-04-06",
    chips=[("L3 Mkt β", "0.39"), ("Vol 23d", "41.5%"), ...],
    grid_rows=20,
    grid_cols=12,
)
```

Every page automatically gets:

1. **Header bar** — title (left, bold navy) + subtitle (right, gray) + navy underline
2. **Chip row** — horizontal strip of key metrics in rounded pill boxes
3. **Footer** — product attribution + date + confidential disclaimer

Callers request **panel axes** via GridSpec slices:

```python
ax = page.panel(row_slice=slice(2, 7), col_slice=slice(1, 6))
chart_hbar(ax, labels, values, ...)
```

The grid is the coordinate system. A 20×12 grid on an 11×8.5" page gives ~0.42" vertical resolution per row. Panels can span any rectangular region — left-half, right-half, full-width, etc.

---

## Chart Primitives: `_charts.py`

Nine reusable functions, each taking an `Axes` and drawing with THEME styling:

| Primitive | Used By | Description |
|-----------|---------|-------------|
| `chart_hbar` | R1, P1 | Horizontal bar (ER decomposition). Rounded-end FancyBboxPatch bars with subtle shadows. |
| `chart_grouped_vbar` | R1 | Grouped vertical bar (HR cascade). Rounded FancyBboxPatch bars. |
| `chart_table` | R1, R2 | Styled Matplotlib table. Navy header, alternating row colors, bold highlight column. |
| `chart_stacked_area` | R2 | Stacked area (ER history, vol contribution). |
| `chart_multi_line` | R3, P2 | Multi-line time series (HR drift, cumulative returns). |
| `chart_waterfall` | P1 | Step-waterfall bar (geometric return attribution — sequential compounding through ERM3 hierarchy). |
| `chart_heatmap` | R4, P4 | Color-coded grid (monthly returns, factor exposure). |
| `chart_histogram` | R3 | Return distribution with current-value marker. |
| `chart_bullet` | — | Horizontal bullet/gauge (vol context). Available but not currently used in R1. |

All primitives follow the same contract:

```python
def chart_XX(ax: Axes, ..., title: str = "", ...) -> Axes:
    """Draw into ax using THEME styling. Return ax for chaining."""
```

No primitive ever imports a color literal, font name, or size constant directly. Everything flows through `THEME`.

---

## Design System: `_theme.py`

`THEME` is a frozen singleton defining the entire visual language:

### Palette
```
navy        #002a5e    Headers, titles, primary emphasis
teal        #006f8e    Secondary series, sector
slate       #2a7fbf    Tertiary series, subsector
green       #00AA00    Positive values (Residual ER)
factor_colors          [navy, teal, slate, green] — cycled for multi-bar charts
pos / neg              Green / red for directional values
panel_bg    #ffffff    Chart panel background
fig_bg      #fafbfc    Page background (very light gray)
chip_bg     #f0f2f5    Metric chip background
```

### Typography
```
family      Inter (with fallback: Liberation Sans → DejaVu Sans → Arial)
page_title  16pt bold
panel_title 10pt bold
body        8.5pt
annotation  7.5pt bold
footer      6pt
```

### Layout
```
page_w      11"  (landscape letter)
page_h      8.5"
dpi         300
margins     left=0.06, right=0.96, top=0.90, bottom=0.04
```

`THEME.apply_globally()` sets Matplotlib rcParams and registers bundled Inter fonts from `~/.local/share/fonts`.

---

## Data Layer

### `StockContext` (`_data.py`)

One call to `fetch_stock_context()` produces everything a stock-level snapshot needs:

- 1× `POST /batch/analyze` → full_metrics + meta (sector_etf, subsector_etf)
- 1× `GET /ticker-returns` → stock daily history with L3 decomposition
- 2× `GET /ticker-returns` → sector + subsector ETF daily returns

Company name is resolved from the `ticker_metadata` Supabase table. Vol is derived from `stock_var` when `vol_23d` is not directly available: `vol = √(stock_var × 252)`.

### `PeerGroupProxy` (`peer_group.py`)

Bridges single stock → synthetic peer portfolio:

1. Queries `ticker_metadata` via Supabase REST for the target's `subsector_etf`
2. Queries same table for all tickers with matching `subsector_etf`, ordered by market cap
3. Cap-weights using `market_cap` from the same table (zero extra API calls for weighting)
4. `compare()` calls `analyze_portfolio()` on the peer weights → `PeerComparison`

The `PeerComparison` dataclass holds: target metrics, peer portfolio aggregation, selection spread (target − peer avg residual ER), per-ticker detail DataFrame.

### AI Narrative

Each snapshot generates a 2-3 sentence analyst narrative — the "so what" a PM reads first:

```python
def _generate_narrative(data: R1Data) -> str:
    # Sentence 1: Peer context (spread in bps)
    # Sentence 2: Dominant risk driver (% of explained variance)
    # Sentence 3: Volatility context (vs peer average)
```

No LLM call — pure computation from the metrics. Stored as a string in the JSON.

---

## R1: Factor Risk Profile

The first page proving this architecture. Layout (20×12 grid):

```
Row 0-1    Header + chips (auto)
Row 2-7    [ER hbar, cols 1-6] [HR cascade, cols 7-12]
Row 7-8    Peer table title
Row 8-15   Peer comparison table (target + top 6 peers)
Row 15-18  AI narrative (bold lead + body)
Row 19     Footer (auto)
```

Chips: L3 Mkt β, L3 Sec β, L3 Sub β, L3 Res ER (α), Vol 23d, Subsector ETF, Spread vs peers.

The render handles abbreviated API keys (`l3_mkt_hr`) and full names (`l3_market_hr`) transparently via a `_g(full, abbr)` helper.

---

## File Map

```
sdk/riskmodels/snapshots/
├── __init__.py          # Public exports, status comments
├── _theme.py            # THEME singleton (palette, type, layout, strokes)
├── _page.py             # SnapshotPage layout engine
├── _charts.py           # 9 chart primitives
├── _data.py             # StockContext + trailing/cumulative return helpers
├── _json_io.py          # dump_json / load_json (envelope, serialization)
├── r1_risk_profile.py   # R1: Factor Risk Profile (first R-series page)
├── s1_forensic.py       # S1: Forensic Factor Decomposition (shipped, legacy)
└── s2_waterfall.py      # S2: Return Attribution Waterfall (shipped, legacy)

sdk/riskmodels/
├── peer_group.py        # PeerGroupProxy + PeerComparison
├── client.py            # RiskModelsClient + get_ticker_metadata()
└── ...
```

---

## Agent Workflow

This architecture is designed for multi-agent iteration:

1. **Opus** (architect) designs the content map: which panels, what data, what narrative template
2. **Human** or **Opus** runs `fetch` once → JSON file (slow, needs API key)
3. **Sonnet** (designer) iterates on `render` using the JSON file (fast, no API, unlimited iterations)
4. **Human** reviews PDF, gives feedback → Sonnet adjusts grid slices, chart params, text positions

The JSON boundary means Sonnet never needs API credentials and can render hundreds of layout variations in minutes.
