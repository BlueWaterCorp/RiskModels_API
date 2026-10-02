"""Deliverable 4 — factor exposure before vs after hedging (Berkshire).

Grouped bars: one group per industry factor layer (market / sector / subsector),
two bars each — pre-hedge (the book's raw dollar-weighted exposure to that layer)
and post-hedge (residual after the overlay's matching-ETF short). Pre-hedge is
materially non-zero; post-hedge is ~0 by construction — that IS the overlay's job.

Reads charts/overlay_data.json (written by compute_overlays.py). Run:
  python sdk/portfolio_timeseries/chart_factor_exposure.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)

import json

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

from portfolio_timeseries import _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
LAYERS = ["market", "sector", "subsector"]
LABELS = ["Market β", "Sector β", "Subsector β"]


def main():
    data = json.loads((_HERE / "charts" / "overlay_data.json").read_text())
    rec = data["Berkshire"]
    # layer_pre_hedge stores Σ Dᵢ·hrᵢ (the hedge ratio, negative for a long book);
    # the book's *exposure* is the opposite sign, so negate for an intuitive read
    # (positive = long exposure the overlay must remove).
    pre = [-rec["layer_pre_hedge"][k] for k in LAYERS]
    post = [rec["layer_post_hedge"][k] for k in LAYERS]

    x = np.arange(len(LAYERS))
    w = 0.38
    fig, ax = plt.subplots(figsize=(10, 5.5))
    b1 = ax.bar(x - w / 2, pre, w, color=ck.NAVY, label="Pre-hedge")
    b2 = ax.bar(x + w / 2, post, w, color=ck.ORANGE, label="Post-hedge (residual)")
    ax.axhline(0, color=ck.GREY, lw=1.0)

    for bars in (b1, b2):
        for b in bars:
            h = b.get_height()
            ax.text(b.get_x() + b.get_width() / 2, h + (abs(max(pre)) * 0.02) * (1 if h >= 0 else -1),
                    ck.money(h), ha="center", va="bottom" if h >= 0 else "top",
                    fontsize=8, color=ck.GREY_TXT)

    ax.set_xticks(x)
    ax.set_xticklabels(LABELS)
    ax.set_ylabel("Dollar-weighted factor exposure (overlay-equivalent)")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: ck.money(v) if v else "$0"))
    ax.legend(frameon=False, fontsize=10, loc="upper right")
    ck.style_ax(ax)
    ax.grid(axis="x", visible=False)

    ck.titles(fig, ax, "Berkshire — industry factor exposure, before vs after the overlay",
              f"Pre-hedge = Σ dollarᵢ · hrᵢ per layer ({rec['n_decomposed']} positions decomposed) · "
              f"post-hedge residual ≈ 0 by construction · {rec['report_date']}")
    fig.text(0.5, -0.01,
             "$ magnitudes per API adj_mv (known 1000× scale issue — see DATA_ISSUES); the "
             "pre→post collapse is scale-invariant. Post-hedge = 0 by construction (overlay "
             "shorts exactly the pre-hedge exposure).", ha="center", fontsize=7,
             color=ck.GREY_TXT, style="italic")

    hi, web = ck.save(fig, "berkshire_factor_exposure_before_after")
    print("[written]", hi)
    print("  pre-hedge:", {k: round(v) for k, v in rec["layer_pre_hedge"].items()})
    print("  post-hedge:", rec["layer_post_hedge"])


if __name__ == "__main__":
    main()
