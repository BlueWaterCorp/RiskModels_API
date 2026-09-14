"""Deliverable 2 — stacked-bar risk decomposition across the four filers.

One stacked bar per filer showing the proportion of total risk attributable to
market / sector / subsector / residual. Four bars side by side, consistent colours,
percentage labels on each segment. The point: different managers carry different
risk profiles (a concentrated activist book vs. a diversified one).

Method (documented honestly on the chart + caption):
  For each disclosed, decomposable position the L3 hedge_levels expose
  {market_er, sector_er, subsector_er, residual_er}, each a share of that position's
  total (they sum to ~1.0 — verified). We take the **dollar-weighted mean** of those
  four shares across the book. This is the decompose engine's own variance-style
  split (ER = explained-return / exposure share), aggregated by dollar weight — NOT a
  proxy derived from hedge ratios.

Consumes charts/risk_detail.json (one decompose fan-out; see compute_risk_detail.py).
Run:  python sdk/portfolio_timeseries/chart_risk_decomposition_stacked.py
"""

from __future__ import annotations

import riskmodels  # noqa: E402,F401
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)

import json

import numpy as np
import matplotlib.pyplot as plt

from portfolio_timeseries import _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
_CHARTS = _HERE / "charts"

LAYERS = [
    ("market_er", "Market", ck.NAVY),
    ("sector_er", "Sector", "#2a7fbf"),      # slate
    ("subsector_er", "Subsector", ck.ORANGE),
    ("residual_er", "Residual (stock-specific)", ck.GREEN),
]
ORDER = ["Berkshire", "Pershing", "Appaloosa", "Greenlight"]


def book_split(detail):
    """Dollar-weighted mean of the four L3 ER shares across a filer's book."""
    w = 0.0
    agg = {k: 0.0 for k, _, _ in LAYERS}
    n = 0
    for p in detail["positions"]:
        if not p.get("decomposed") or not p.get("dollars"):
            continue
        if p.get("market_er") is None:
            continue
        d = p["dollars"]
        w += d
        n += 1
        for k, _, _ in LAYERS:
            agg[k] += d * (p.get(k) or 0.0)
    if w == 0:
        return None, 0, 0.0
    split = {k: agg[k] / w for k in agg}
    total = sum(split.values())
    # renormalize to exactly 1.0 (guards against tiny None-induced drift)
    split = {k: v / total for k, v in split.items()}
    return split, n, w


def main():
    data = json.loads((_CHARTS / "risk_detail.json").read_text())

    filers = [f for f in ORDER if f in data]
    splits, metas = [], []
    for f in filers:
        s, n, w = book_split(data[f])
        splits.append(s)
        metas.append((data[f]["report_date"], n, data[f]["n_positions"]))
        if s:
            print(f"{f}: " + "  ".join(f"{lab}={s[k]*100:.1f}%" for k, lab, _ in LAYERS)
                  + f"   (n_decomposed={n})")

    fig, ax = plt.subplots(figsize=(11, 7))
    x = np.arange(len(filers))
    width = 0.55
    bottoms = np.zeros(len(filers))
    for k, label, color in LAYERS:
        vals = np.array([(s[k] * 100 if s else 0.0) for s in splits])
        ax.bar(x, vals, width, bottom=bottoms, color=color, label=label,
               edgecolor="white", linewidth=0.8)
        for xi, (v, b) in enumerate(zip(vals, bottoms)):
            if v >= 3.0:  # label only visible segments
                ax.text(xi, b + v / 2, f"{v:.0f}%", ha="center", va="center",
                        fontsize=9, color="white", fontweight="bold")
        bottoms += vals

    ax.set_xticks(x)
    ax.set_xticklabels(
        [f"{f}\n({rd}, n={n}/{tot})" for f, (rd, n, tot) in zip(filers, metas)],
        fontsize=9)
    ax.set_ylabel("Share of total risk (%)")
    ax.set_ylim(0, 100)
    ax.set_yticks(range(0, 101, 20))
    ck.style_ax(ax)
    ax.grid(axis="x", visible=False)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.08), ncol=4,
              frameon=False, fontsize=9)

    fig.suptitle("Risk decomposition by filer — market / sector / subsector / residual",
                 fontsize=14, fontweight="bold", y=0.98)
    ax.set_title("Dollar-weighted mean of per-position L3 ER shares (decompose engine; shares sum to 100%).  "
                 "Concentrated activist books carry a different mix than diversified ones.",
                 fontsize=8.5, color=ck.GREY_TXT, pad=10)
    fig.tight_layout(rect=[0, 0.02, 1, 0.96])
    hi, web = ck.save(fig, "risk_decomposition_stacked")
    print("[written]", hi)

    write_caption(filers, splits, metas)


def write_caption(filers, splits, metas):
    lines = [
        "# Risk Decomposition (stacked) — all filers",
        "",
        "**File:** `charts/risk_decomposition_stacked.png` (+ `_web.png`)",
        "",
        "## What it shows",
        "",
        "One stacked bar per filer: the proportion of total risk attributable to **market**, "
        "**sector**, **subsector**, and **residual (stock-specific)** risk. Read left-to-right, "
        "it makes the point that **different managers carry different risk profiles** — the mix "
        "is not the same across books.",
        "",
        "## Numbers",
        "",
        "| Filer | Book | n | Market | Sector | Subsector | Residual |",
        "|---|---|---|---|---|---|---|",
    ]
    for f, s, (rd, n, tot) in zip(filers, splits, metas):
        if not s:
            lines.append(f"| {f} | {rd} | {n}/{tot} | — | — | — | — |")
            continue
        lines.append(f"| {f} | {rd} | {n}/{tot} | {s['market_er']*100:.1f}% | "
                     f"{s['sector_er']*100:.1f}% | {s['subsector_er']*100:.1f}% | "
                     f"{s['residual_er']*100:.1f}% |")
    lines += [
        "",
        "## How it was computed",
        "",
        "For each disclosed, decomposable position, `decompose()`'s `hedge_levels.L3` exposes "
        "`market_er`, `sector_er`, `subsector_er`, `residual_er` — each the share of that "
        "position's total, summing to ~1.0 (verified, e.g. AAPL 0.227 + 0.009 + 0.006 + 0.759 = "
        "1.00). The chart is the **dollar-weighted mean** of those four shares across the book, "
        "renormalized to 100%. This is the decompose engine's own variance-style split aggregated "
        "by dollar weight — **not** a proxy derived from hedge ratios.",
        "",
        "## Caveats",
        "",
        "- `er` is the engine's exposure/explained-return share, not a portfolio-variance "
        "computation with cross-position covariances; it treats each position's split independently "
        "and dollar-weights them. It answers 'where does the average dollar's risk sit', which is "
        "the intended read.",
        "- Restricted / unresolved rows (`BW-RESTRICTED`, unresolved FIGIs) carry no decomposition "
        "and are excluded — most material for **Greenlight** (its top ~27.5% line is restricted), "
        "so its bar reflects only the decomposable remainder of a stale (2023-12-31) book.",
    ]
    (_CHARTS / "risk_decomposition_stacked.md").write_text("\n".join(lines) + "\n")
    print("[written] charts/risk_decomposition_stacked.md")


if __name__ == "__main__":
    main()
