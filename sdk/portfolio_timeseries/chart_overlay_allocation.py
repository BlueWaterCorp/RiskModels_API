"""Deliverable 2 — overlay allocation bar charts (Berkshire, Pershing).

Horizontal bars, one per ETF in the overlay: shorts to the right (positive x),
longs to the left (negative x), sorted by absolute size (largest at top). Each bar
labelled with its dollar amount; a summary box (top-right) reports gross long book,
net overlay short, gross notional leverage, and ETF count.

Reads charts/overlay_data.json (written by compute_overlays.py). Run:
  python sdk/portfolio_timeseries/chart_overlay_allocation.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)

import json

import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

from portfolio_timeseries import _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
SCALE_NOTE = ("$ magnitudes are the API's current-period adj_mv (known 1000× scale "
              "issue — see DATA_ISSUES). Proportions & leverage are exact.")


def render(name, rec):
    etf_shorts = rec["etf_shorts"]
    gross_long = rec["gross_long"]
    # signed: positive = short (right), negative = long (left)
    items = sorted(etf_shorts.items(), key=lambda kv: abs(kv[1]))  # smallest first -> bottom
    etfs = [e for e, _ in items]
    vals = [v for _, v in items]

    net_short = sum(vals)
    gross_notional = sum(abs(v) for v in vals)
    leverage = gross_notional / gross_long if gross_long else float("nan")

    fig, ax = plt.subplots(figsize=(11, max(5.5, 0.42 * len(etfs) + 2)))
    colors = [ck.RED if v > 0 else ck.GREEN for v in vals]
    bars = ax.barh(etfs, vals, color=colors, height=0.72)
    ax.axvline(0, color=ck.GREY, lw=1.0)

    span = max(abs(min(vals)), abs(max(vals)))
    for b, v in zip(bars, vals):
        off = span * 0.015
        ax.text(v + (off if v >= 0 else -off), b.get_y() + b.get_height() / 2,
                ck.money(v), va="center", ha="left" if v >= 0 else "right",
                fontsize=8, color=ck.GREY_TXT)
    ax.set_xlim(-span * 1.28, span * 1.28)

    ck.style_ax(ax)
    ax.grid(axis="y", visible=False)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: ck.money(v) if v else "$0"))
    ax.set_xlabel("← long the ETF          overlay position ($)          short the ETF →", fontsize=9)

    ck.titles(fig, ax, f"{name} — market-neutral ETF overlay allocation",
              f"Industry-axis (market + sector + subsector) · {rec['report_date']} · "
              f"{len(etfs)} ETFs · net {'short' if net_short>0 else 'long'}")

    # summary box, top-right
    txt = (f"Gross long book:   {ck.money(gross_long)}\n"
           f"Net overlay short: {ck.money(net_short)}\n"
           f"Gross notional:    {ck.money(gross_notional)}\n"
           f"Leverage (gross/book): {leverage:.2f}×\n"
           f"ETFs used:  {len(etfs)}")
    ax.text(0.985, 0.04, txt, transform=ax.transAxes, fontsize=8.5, family="monospace",
            va="bottom", ha="right", color=ck.NAVY,
            bbox=dict(boxstyle="round,pad=0.5", fc="#f4f6f9", ec="#c9d3df"))
    fig.text(0.5, -0.01, SCALE_NOTE, ha="center", fontsize=7, color=ck.GREY_TXT, style="italic")

    stem = f"{name.lower()}_overlay_allocation"
    hi, web = ck.save(fig, stem)
    print("[written]", hi)
    return {"net_short": net_short, "gross_notional": gross_notional, "leverage": leverage,
            "n_etfs": len(etfs), "gross_long": gross_long}


def main():
    data = json.loads((_HERE / "charts" / "overlay_data.json").read_text())
    for name in ("Berkshire", "Pershing"):
        if name in data:
            s = render(name, data[name])
            print(f"  {name}: leverage {s['leverage']:.2f}x, {s['n_etfs']} ETFs, "
                  f"net short {ck.money(s['net_short'])}")


if __name__ == "__main__":
    main()
