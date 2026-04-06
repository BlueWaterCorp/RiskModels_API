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
R1 (Current × Stock)      — Factor Risk Profile           [planned]
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

# Legacy S1/S2 (will be replaced by R1/R2)
from .s1_forensic import S1Data, get_data_for_s1, render_s1_to_pdf
from .s2_waterfall import S2Data, get_data_for_s2, render_s2_to_pdf

__all__ = [
    # Data layer
    "StockContext",
    "fetch_stock_context",
    "trailing_returns",
    "cumulative_returns",
    "rolling_sharpe",
    "max_drawdown_series",
    "relative_returns",
    # Legacy
    "S1Data",
    "get_data_for_s1",
    "render_s1_to_pdf",
    "S2Data",
    "get_data_for_s2",
    "render_s2_to_pdf",
]
