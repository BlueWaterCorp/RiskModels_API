"""Shared chart styling + helpers for the 13F presentation charts.

One visual language across every deliverable (per the meeting style guide):
navy primary, orange secondary, muted-grey references; bold title, grey subtitle;
no top/right spines; minimal gridlines; dollar amounts as $XXB / $XXXM.

Every chart saves a 150-DPI PNG and a 72-DPI `_web.png` (≤1600px wide) via
:func:`save`. Import-order shim lives in the entry scripts, not here.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Visual language (matches the existing berkshire_raw_vs_hedged chart).
NAVY = "#002a5e"     # primary series
ORANGE = "#E07000"   # secondary series
GREY = "#999999"     # reference lines
GREY_TXT = "#444444"  # subtitle / metadata text
GRID = "#e6e6e6"
GREEN = "#00AA00"    # positive / long
RED = "#C0392B"      # negative / short (readable vs orange)

CHARTS_DIR = Path(__file__).parent / "charts"


def money(x: float) -> str:
    """Format a dollar amount as $X.XB / $XXXM / $XXXk, sign-aware."""
    ax = abs(x)
    sign = "-" if x < 0 else ""
    if ax >= 1e9:
        return f"{sign}${ax / 1e9:.1f}B"
    if ax >= 1e6:
        return f"{sign}${ax / 1e6:.0f}M"
    if ax >= 1e3:
        return f"{sign}${ax / 1e3:.0f}k"
    return f"{sign}${ax:.0f}"


def style_ax(ax):
    """Apply the house style to a single Axes."""
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="both", color=GRID, lw=0.6)
    ax.set_axisbelow(True)


def titles(fig, ax, title, subtitle):
    """Bold suptitle + grey metadata subtitle (subtitle as the axes title)."""
    fig.suptitle(title, fontsize=13, fontweight="bold", y=0.98)
    if subtitle:
        ax.set_title(subtitle, fontsize=9, color=GREY_TXT, pad=10)


def save(fig, stem: str):
    """Save `<stem>.png` (150 DPI) + `<stem>_web.png` (72 DPI, ≤1600px wide)."""
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    hi = CHARTS_DIR / f"{stem}.png"
    fig.savefig(hi, dpi=150, bbox_inches="tight")
    # Web version: cap width at 1600px. figure width(in) * 72 <= 1600 -> width <= 22.2in,
    # already satisfied by our figure sizes, so 72 DPI is the only change.
    web = CHARTS_DIR / f"{stem}_web.png"
    fig.savefig(web, dpi=72, bbox_inches="tight")
    plt.close(fig)
    return hi, web
