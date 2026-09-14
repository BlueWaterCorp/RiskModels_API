"""Chart for the RRG regime split (§5). Sector-level only (subsector coverage ~10%, unusable).

Left: D.E.Shaw's book weight by regime quadrant at report date (the barbell).
Right: per-unit-weight window return by quadrant, windows A (+1..10, pre-disclosure) and E
(+45..55, post-public). Reads cache/deshaw_regime_results.json. House style (_chartkit).
"""
from __future__ import annotations
import sys, json
from pathlib import Path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np
import matplotlib.pyplot as plt
import _chartkit as ck

RES = _HERE / "cache" / "deshaw_regime_results.json"
QUADS = ["Leading", "Improving", "Weakening", "Lagging"]


def main():
    r = json.load(open(RES))
    sec = r["levels"]["sector"]
    cov = sec["map_coverage"]["median"]
    a = sec["windows"]["A_1_10"]["quadrants"]
    e = sec["windows"]["E_45_55"]["quadrants"]
    weights = [a[q]["mean_weight"] * 100 for q in QUADS]
    aret = [a[q]["mean_ret_bps"] for q in QUADS]
    eret = [e[q]["mean_ret_bps"] for q in QUADS]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.6))
    colors = [ck.NAVY, "#2a7fbf", ck.ORANGE, ck.GREY]

    ax1.bar(QUADS, weights, color=colors, zorder=3)
    ax1.axhline(25, color=ck.GREY, lw=1, ls="--")
    ax1.text(3.4, 25.6, "equal-weight 25%", fontsize=7, color=ck.GREY_TXT, ha="right")
    ck.style_ax(ax1); ax1.set_ylabel("book weight (%)")
    ax1.set_title("Weight by regime quadrant at report date — a Leading/Lagging barbell",
                  fontsize=9, color=ck.GREY_TXT, pad=8)

    x = np.arange(len(QUADS)); w = 0.38
    ax2.bar(x - w / 2, aret, w, color=ck.NAVY, label="+1..10 (pre-disclosure)", zorder=3)
    ax2.bar(x + w / 2, eret, w, color=ck.ORANGE, label="+45..55 (post-public)", zorder=3)
    ax2.axhline(0, color=ck.GREY, lw=0.8)
    ax2.set_xticks(x); ax2.set_xticklabels(QUADS)
    ck.style_ax(ax2); ax2.set_ylabel("per-unit-weight return (bps)")
    ax2.legend(frameon=False, fontsize=8)
    ax2.set_title("Post-report return by quadrant — drift NOT concentrated in Leading; gone by +45d",
                  fontsize=9, color=ck.GREY_TXT, pad=8)

    fig.suptitle("D. E. Shaw — post-report window split by RRG sector regime (point-in-time)",
                 fontsize=13, fontweight="bold", y=1.0)
    fig.text(0.5, -0.02, f"Sector coverage {cov:.0%} of book weight · split of a mostly-beta signal "
             f"(β≈1.3) — characterisation, not a rotation edge · NOT tradeable",
             ha="center", fontsize=8, color=ck.GREY_TXT)
    ck.save(fig, "deshaw_regime_split")
    (ck.CHARTS_DIR / "deshaw_regime_split.md").write_text(
        "**D. E. Shaw post-report window by RRG sector regime (point-in-time labels, Rothe 2023).** "
        f"Left: book weight per quadrant at report date (sector coverage {cov:.0%}) — a barbell of "
        "Leading + Lagging, underweighting the transitional middle; not a momentum concentration. "
        "Right: per-unit-weight return by quadrant for the pre-disclosure (+1..10) and post-public "
        "(+45..55) windows — the drift is weakest in Leading and washes out by the filing date. "
        "**The right-hand panel is BETA, not a regime effect (tested 2026-09-07).** Regressing each "
        "quadrant basket on SPY over the identical window: Leading carries beta 1.00 while Improving "
        "and Weakening carry ~1.26, so the raw ordering is a beta ordering. No quadrant alpha is "
        "significant, and the headline Leading−Weakening difference falls from −136 bps (t=−2.73) to "
        "alpha −95 bps (t=−2.29), below the six-test Bonferroni bar of 2.64 — as does every other "
        "pair. Read the LEFT panel (positioning) as the result; read the right panel as beta. "
        "Characterisation only; NOT tradeable (window is pre-disclosure). Subsector split "
        "omitted (only ~10% coverage). See DESHAW_REPORT_DATE §5.1.\n")
    print("wrote charts/deshaw_regime_split.png")


if __name__ == "__main__":
    main()
