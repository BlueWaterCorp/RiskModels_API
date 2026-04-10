"""Phase A verification — render a demo page with all chart primitives.

Run:  python -m tests.test_phase_a
Output: sdk/riskmodels/snapshots/output/phase_a_demo.pdf
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd
from pathlib import Path

from riskmodels.snapshots._theme import THEME
from riskmodels.snapshots._page import SnapshotPage
from riskmodels.snapshots._charts import (
    chart_hbar,
    chart_grouped_vbar,
    chart_multi_line,
    chart_heatmap,
    chart_table,
    chart_histogram,
)


def main():
    # ── Create page ────────────────────────────────────────────────
    chips = [
        ("Mkt β", "1.32"),
        ("Vol 23d", "42.1%"),
        ("Mkt ER", "+3.2%"),
        ("Sec ER", "-1.1%"),
        ("Sub ER", "+0.8%"),
        ("Res ER", "+2.4%"),
        ("Sharpe", "1.85"),
        ("Max DD", "-12.3%"),
    ]

    page = SnapshotPage(
        title="NVDA — NVIDIA Corporation",
        subtitle="DEMO · Phase A Verification",
        ticker="NVDA",
        teo="2026-04-02",
        chips=chips,
    )

    # ── Panel A: Horizontal bar (top-left) ─────────────────────────
    ax_a = page.panel(slice(2, 7), slice(0, 6))
    chart_hbar(
        ax_a,
        labels=["Market", "Sector", "Subsector", "Residual"],
        values=[3.2, -1.1, 0.8, 2.4],
        colors=THEME.palette.factor_colors,
        title="L3 Explained Return Decomposition",
    )

    # ── Panel B: Grouped vbar (top-right) ──────────────────────────
    ax_b = page.panel(slice(2, 7), slice(6, 12))
    chart_grouped_vbar(
        ax_b,
        group_labels=["L1", "L2", "L3"],
        series={
            "Market HR": [0.95, 0.92, 0.88],
            "Sector HR": [0.0, 0.78, 0.72],
            "Sub HR":    [0.0, 0.0,  0.65],
        },
        title="Hedge Ratio Cascade",
        ylabel="Ratio",
    )

    # ── Panel C: Multi-line (bottom-left) ──────────────────────────
    ax_c = page.panel(slice(7, 12), slice(0, 6))
    np.random.seed(42)
    dates = pd.date_range("2025-04-01", periods=252, freq="B")
    stock = np.cumsum(np.random.normal(0.001, 0.02, 252))
    spy   = np.cumsum(np.random.normal(0.0005, 0.012, 252))
    chart_multi_line(
        ax_c,
        dates=dates,
        lines={"NVDA": stock, "SPY": spy},
        colors=[THEME.palette.navy, THEME.palette.orange],
        title="Cumulative Returns",
        pct_fmt=True,
        zero_line=True,
    )

    # ── Panel D: Table (bottom-right) ──────────────────────────────
    ax_d = page.panel(slice(7, 12), slice(6, 12))
    chart_table(
        ax_d,
        headers=["Metric", "NVDA", "SMH", "XLK", "SPY"],
        rows=[
            ["Ann. Return",   "+45.2%", "+28.1%", "+22.3%", "+18.7%"],
            ["Sharpe",        "1.85",   "1.42",   "1.31",   "1.15"],
            ["Max Drawdown",  "-12.3%", "-8.7%",  "-7.2%",  "-5.8%"],
            ["Vol (23d)",     "42.1%",  "31.2%",  "24.8%",  "16.3%"],
            ["Tracking Err",  "—",      "18.4%",  "22.1%",  "28.9%"],
        ],
        title="Performance Summary",
        highlight_col=1,
    )

    # ── Save ───────────────────────────────────────────────────────
    out = Path(__file__).resolve().parent.parent / "riskmodels" / "snapshots" / "output" / "phase_a_demo.pdf"
    page.save(out)
    print(f"✓ Phase A demo saved → {out}")
    print(f"  Page size: {THEME.layout.page_w}×{THEME.layout.page_h} in (landscape)")
    print(f"  DPI: {THEME.layout.dpi}")


if __name__ == "__main__":
    main()
