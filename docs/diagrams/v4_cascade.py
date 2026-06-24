"""
v4 decomposition cascade diagram (PNG).

Renders the v4 "two factor blocks + one stock-specific residual" decomposition as a
descending staircase — one box per removal step, each indented below the one above —
with dotted leader lines tying every step to its new v4 API surface name (response
field path + metric key), grouped under the serving endpoint.

Refine loop:  python3 docs/diagrams/v4_cascade.py
Output:       docs/diagrams/v4_cascade.png  (+ copy to ~/Downloads for Quick Look)
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

# Reuse the snapshot THEME so fonts (Inter) + palette match the suite.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk"))
try:
    from riskmodels.snapshots._theme import THEME

    THEME.apply()
    P = THEME.palette
    NAVY, TEAL, VIOLET = P.navy, P.teal, P.subsector
    GREEN, ORANGE = P.green, P.orange
    INK, MID, LIGHT = P.text_dark, P.text_mid, P.text_light
    GRID, BORDER = P.grid, P.border
    CHIP_BG, CHIP_BD = P.chip_bg, P.chip_border
except Exception:  # pragma: no cover - theme optional
    NAVY, TEAL, VIOLET = "#002a5e", "#006f8e", "#6d28d9"
    GREEN, ORANGE = "#00AA00", "#E07000"
    INK, MID, LIGHT = "#1a1a2e", "#475569", "#94a3b8"
    GRID, BORDER = "#e2e8f0", "#cbd5e1"
    CHIP_BG, CHIP_BD = "#eef2f7", "#dce3ed"

MONO = "DejaVu Sans Mono"

# ── Cascade steps (top → bottom). Each carves a layer off the gross return. ──
#   label, sublabel, fill, hedge-tag, v4 field path, metric key
STEPS = [
    ("Gross return",   "stock total return (the input)",          INK,    "input",
     "—",                                "returns_gross"),
    ("Market",         "broad-market beta · SPY",                 NAVY,   "ETF-hedgeable",
     "decomposition.market",                    "l3_mkt_er"),
    ("Sector",         "industry block · L2",                     TEAL,   "ETF-hedgeable",
     "decomposition.industry.layers.sector",    "l3_sec_er"),
    ("Subsector",      "industry block · L3",                     VIOLET, "ETF-hedgeable",
     "decomposition.industry.layers.subsector", "l3_sub_er"),
    ("Style",          "size + value spreads · SMB, HML",         ORANGE, "diagnostic",
     "decomposition.style",                     "style_er"),
    ("Stock-specific", "the one residual — the bet",              GREEN,  "residual",
     "decomposition.stock_specific",     "stock_specific_er"),
]

# ── Geometry ─────────────────────────────────────────────────────────────────
FIG_W, FIG_H = 14.0, 9.0
X_MAX, Y_MAX = 14.0, 9.0

BOX_W, BOX_H = 4.7, 0.80
PITCH = 1.16                      # vertical center-to-center
Y_TOP = 7.42                      # center of first row
X_LEFT0 = 0.85                    # left edge of first box
INDENT = 0.50                     # rightward shift per step

X_SPINE = 9.55                    # endpoint spine x
X_ENDPOINT_TXT = 9.85            # endpoint label x


def row_y(i: int) -> float:
    return Y_TOP - i * PITCH


def row_xleft(i: int) -> float:
    return X_LEFT0 + i * INDENT


def main() -> None:
    fig = plt.figure(figsize=(FIG_W, FIG_H), dpi=200)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, X_MAX)
    ax.set_ylim(0, Y_MAX)
    ax.axis("off")

    # ── Title block ──────────────────────────────────────────────────────────
    ax.text(0.85, 8.62, "RiskModels v4 — Decomposition Cascade",
            fontsize=21, fontweight="bold", color=NAVY, va="center")
    ax.text(0.85, 8.18,
            "Two factor blocks (industry + style) on top of market, then one "
            "stock-specific residual.   market + blocks + stock_specific ≈ 1.0",
            fontsize=11.5, color=MID, va="center")

    # ── Endpoint spine (right column) ────────────────────────────────────────
    y_first, y_last = row_y(1), row_y(len(STEPS) - 1)
    ax.plot([X_SPINE, X_SPINE], [y_last - 0.18, y_first + 0.18],
            color=BORDER, lw=1.4, zorder=1)
    ax.text(X_ENDPOINT_TXT, y_first + 0.62, "v4 API surface",
            fontsize=10.5, fontweight="bold", color=NAVY, va="center")
    ax.text(X_ENDPOINT_TXT, y_first + 0.36, "POST /api/v4/decompose",
            fontsize=9.5, color=TEAL, va="center", family=MONO)

    # ── Cascade staircase ────────────────────────────────────────────────────
    for i, (label, sub, fill, tag, field, mkey) in enumerate(STEPS):
        yc = row_y(i)
        xl = row_xleft(i)
        xr = xl + BOX_W
        is_input = tag == "input"

        # Connector from previous box → this box (elbow: down then right arrow in).
        if i > 0:
            xprev = row_xleft(i - 1) + 0.28
            yprev_bot = row_y(i - 1) - BOX_H / 2
            ax.plot([xprev, xprev], [yprev_bot, yc], color=LIGHT, lw=1.6, zorder=1)
            arr = FancyArrowPatch((xprev, yc), (xl - 0.02, yc),
                                  arrowstyle="-|>", mutation_scale=12,
                                  color=LIGHT, lw=1.6, zorder=1)
            ax.add_patch(arr)

        # Step box (rounded, subtle shadow).
        shadow = FancyBboxPatch((xl + 0.035, yc - BOX_H / 2 - 0.045), BOX_W, BOX_H,
                                boxstyle="round,pad=0.02,rounding_size=0.12",
                                fc="#00000010", ec="none", zorder=2)
        ax.add_patch(shadow)
        face = "#ffffff" if is_input else fill
        edge = BORDER if is_input else fill
        box = FancyBboxPatch((xl, yc - BOX_H / 2), BOX_W, BOX_H,
                             boxstyle="round,pad=0.02,rounding_size=0.12",
                             fc=face, ec=edge, lw=1.6, zorder=3)
        ax.add_patch(box)

        txt_main = INK if is_input else "#ffffff"
        txt_sub = MID if is_input else "#ffffffcc"
        ax.text(xl + 0.28, yc + 0.135, label, fontsize=14.5, fontweight="bold",
                color=txt_main, va="center", zorder=4)
        ax.text(xl + 0.28, yc - 0.175, sub, fontsize=9.5, color=txt_sub,
                va="center", zorder=4)

        # Hedge / role tag chip (right side inside box).
        if not is_input:
            tag_color = {"ETF-hedgeable": "#ffffff", "diagnostic": "#ffffff",
                         "residual": "#ffffff"}[tag]
            ax.text(xr - 0.22, yc, tag, fontsize=8.2, color=tag_color, alpha=0.92,
                    va="center", ha="right", style="italic", zorder=4)

        # Endpoint leader (dotted) → spine node → field path + metric key.
        ax.plot([xr + 0.04, X_SPINE], [yc, yc], color=BORDER, lw=1.1,
                ls=(0, (1.5, 2.2)), zorder=1)
        ax.scatter([X_SPINE], [yc], s=26, color=fill if not is_input else MID,
                   zorder=4, edgecolors="white", linewidths=0.8)
        ax.text(X_ENDPOINT_TXT, yc + 0.13, field, fontsize=10.5,
                color=INK if not is_input else LIGHT, va="center", family=MONO,
                fontweight="bold" if not is_input else "normal")
        ax.text(X_ENDPOINT_TXT, yc - 0.165,
                mkey if is_input else f"{mkey}   ·   /lstar · /returns-decomposition"
                if label == "Stock-specific" else mkey,
                fontsize=8.6, color=MID, va="center", family=MONO)

    # ── Footnote ─────────────────────────────────────────────────────────────
    ax.text(0.85, 0.55,
            "Style is a two-factor block — SMB (size) + HML (value), orthogonalized "
            "against {market, industry}; momentum (WML) and RMW are dropped (post-2013 "
            "ETF inception would break the 2000 panel). Industry is ETF-hedgeable; "
            "style is diagnostic. stock_specific is the single idiosyncratic residual.",
            fontsize=9, color=LIGHT, va="center")

    out = Path(__file__).resolve().parent / "v4_cascade.png"
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"wrote {out}")

    # Copy to ~/Downloads for Finder / Quick Look.
    dl = Path.home() / "Downloads" / "v4_cascade.png"
    try:
        shutil.copyfile(out, dl)
        print(f"copied {dl}")
    except Exception as e:  # pragma: no cover
        print(f"(downloads copy skipped: {e})")


if __name__ == "__main__":
    main()
