"""Institutional PDF Snapshot Suite — Risk (R1–R4) and Performance (P1–P4).

Architecture
------------
Pure Matplotlib figures (11×8.5 landscape). One figure = one page, zero whitespace.
No HTML/WeasyPrint. GridSpec controls all panel sizing.

Data layer
----------
    fetch_stock_context(ticker, client)  → StockContext  (all stock-level data in one call)

Each snapshot follows fetch/render separation:
    get_data_for_XX(context)             → dataclass    (select + compute)
    render_XX_to_pdf(data, output_path)  → Path         (Matplotlib only)

Available snapshots
-------------------
R1 (Current × Stock)      — Factor Risk Profile           [shipped]
R2 (History × Stock)      — Risk Attribution Drift         [planned]
R3 (Current × Portfolio)  — Concentration Mekko            [planned]
R4 (History × Portfolio)  — Style Drift                    [planned]
P1 (Current × Stock)      — Return + Relative Performance  [planned]
P2 (History × Stock)      — Cumulative Performance         [planned]
P3 (Current × Portfolio)  — Return Contribution            [planned]
P4 (History × Portfolio)  — Portfolio vs Benchmark         [planned]

Requires
--------
    pip install riskmodels-py[pdf]
    # installs: matplotlib (only renderer needed)
"""

# Design system (Matplotlib — legacy S1/S2 only)
from ._theme import THEME, Theme, Palette, Typography, Layout, Strokes

# Design system (Plotly — all new snapshots)
from ._plotly_theme import PLOTLY_THEME, PlotlyTheme, apply_theme

# Layout engine (Matplotlib — legacy)
from ._page import SnapshotPage

# Chart primitives — Matplotlib (legacy S1/S2)
from ._charts import (
    chart_hbar,
    chart_grouped_vbar,
    chart_stacked_area,
    chart_multi_line,
    chart_waterfall,
    chart_heatmap,
    chart_table,
    chart_histogram,
    chart_bullet,
)

# Chart primitives — Plotly (all new snapshots)
from ._plotly_charts import (
    chart_hbar as px_hbar,
    chart_grouped_vbar as px_grouped_vbar,
    chart_stacked_area as px_stacked_area,
    chart_multi_line as px_multi_line,
    chart_waterfall as px_waterfall,
    chart_heatmap as px_heatmap,
    chart_table as px_table,
    chart_histogram as px_histogram,
    chart_bullet as px_bullet,
)

# Shared data layer
from ._data import (
    StockContext,
    fetch_stock_context,
    trailing_returns,
    cumulative_returns,
    rolling_sharpe,
    max_drawdown_series,
    relative_returns,
)

# JSON-first pipeline
from ._json_io import dump_json, load_json

# R1 — Factor Risk Profile (pure Plotly)
from .r1_risk_profile import (
    R1Data,
    get_data_for_r1,
    render_r1_to_pdf,
    render_r1_to_png,
    render_r1_to_png_bytes,
    render_r1_to_json,
)

# Legacy S1/S2 (will be replaced by R1/R2)
from .s1_forensic import S1Data, get_data_for_s1, render_s1_to_pdf
from .s2_waterfall import S2Data, get_data_for_s2, render_s2_to_pdf

__all__ = [
    # Design system — Matplotlib (legacy S1/S2)
    "THEME", "Theme", "Palette", "Typography", "Layout", "Strokes",
    # Design system — Plotly (all new snapshots)
    "PLOTLY_THEME", "PlotlyTheme", "apply_theme",
    # Layout engine — Matplotlib (legacy)
    "SnapshotPage",
    # Chart primitives — Matplotlib (legacy)
    "chart_hbar",
    "chart_grouped_vbar",
    "chart_stacked_area",
    "chart_multi_line",
    "chart_waterfall",
    "chart_heatmap",
    "chart_table",
    "chart_histogram",
    "chart_bullet",
    # Chart primitives — Plotly (new)
    "px_hbar",
    "px_grouped_vbar",
    "px_stacked_area",
    "px_multi_line",
    "px_waterfall",
    "px_heatmap",
    "px_table",
    "px_histogram",
    "px_bullet",
    # Data layer
    "StockContext",
    "fetch_stock_context",
    "trailing_returns",
    "cumulative_returns",
    "rolling_sharpe",
    "max_drawdown_series",
    "relative_returns",
    # JSON-first pipeline
    "dump_json",
    "load_json",
    # R1 — Factor Risk Profile
    "R1Data",
    "get_data_for_r1",
    "render_r1_to_pdf",
    "render_r1_to_png",
    "render_r1_to_png_bytes",
    "render_r1_to_json",
    # Legacy
    "S1Data",
    "get_data_for_s1",
    "render_s1_to_pdf",
    "S2Data",
    "get_data_for_s2",
    "render_s2_to_pdf",
]
