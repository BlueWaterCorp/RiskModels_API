"""Deliverable 3 — cross-filer concentration comparison (small multiples).

One panel per resolved filer: top-10 positions as a horizontal bar chart,
x = % of portfolio, ticker on y, largest at top. Consistent x-axis across panels
for comparability. Panel title = filer name; subtitle = top-5 concentration %.

Reads charts/filer_data.json (written by wire_filers.py). Run:
  python sdk/portfolio_timeseries/chart_concentration.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)

import json
import math

import matplotlib.pyplot as plt

from portfolio_timeseries import _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
ORDER = ["Berkshire", "Pershing", "Appaloosa", "Greenlight"]


def _clean(t):
    """Human label: mark unresolved/restricted rows explicitly."""
    if t == "BW-RESTRICTED":
        return "‹restricted›"
    if t.startswith("BW-"):
        return "‹unresolved›"
    return t


def main():
    data = json.loads((_HERE / "charts" / "filer_data.json").read_text())
    filers = [f for f in ORDER if f in data]
    n = len(filers)
    print("filers:", filers)

    # shared x-axis: max top-1 weight across all filers, rounded up.
    max_w = max(max(p["weight"] for p in data[f]["top10_positions"]) for f in filers)
    xmax = math.ceil(max_w * 100 / 5) * 5  # nearest 5%

    ncols = 2 if n > 1 else 1
    nrows = math.ceil(n / ncols)
    fig, axes = plt.subplots(nrows, ncols, figsize=(12, 3.5 * nrows), squeeze=False)

    for k, fname in enumerate(filers):
        ax = axes[k // ncols][k % ncols]
        rec = data[fname]
        pos = rec["top10_positions"][::-1]  # reverse so largest ends on top
        labels = [_clean(p["ticker"]) for p in pos]
        vals = [p["weight"] * 100 for p in pos]
        colors = [ck.GREY if labels[i].startswith("‹") else ck.NAVY for i in range(len(labels))]
        bars = ax.barh(labels, vals, color=colors, height=0.72)
        for b, v in zip(bars, vals):
            ax.text(b.get_width() + xmax * 0.012, b.get_y() + b.get_height() / 2,
                    f"{v:.1f}%", va="center", fontsize=8, color=ck.GREY_TXT)
        ax.set_xlim(0, xmax * 1.12)
        stale = "   ⚠ stale" if rec["report_date"] < "2025" else ""
        ax.text(0.0, 1.16, fname, transform=ax.transAxes, fontsize=11, fontweight="bold")
        ax.text(0.0, 1.04, f"top-5 = {rec['top5']:.0%}   ·   HHI {rec['hhi']:.3f}   ·   "
                f"{rec['report_date']}{stale}",
                transform=ax.transAxes, fontsize=8, color=ck.GREY_TXT)
        ax.set_xlabel("% of portfolio", fontsize=9)
        ck.style_ax(ax)
        ax.grid(axis="y", visible=False)

    # hide any unused panel
    for k in range(n, nrows * ncols):
        axes[k // ncols][k % ncols].set_visible(False)

    fig.suptitle("13F long-book concentration — top-10 positions by filer",
                 fontsize=14, fontweight="bold", y=1.0)
    fig.tight_layout(rect=[0, 0, 1, 0.96], h_pad=3.5)
    hi, web = ck.save(fig, "concentration_comparison")
    print("[written]", hi)
    print("[written]", web)


if __name__ == "__main__":
    main()
