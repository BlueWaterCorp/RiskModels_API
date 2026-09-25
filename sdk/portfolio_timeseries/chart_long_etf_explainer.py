"""Deliverable 3 — why long-ETF positions appear in a market-neutral overlay (Berkshire).

Two-panel figure:
  Left  — Berkshire's book sector weights vs SPY's sector weights (grouped hbar).
          The tech gap is the headline: Berkshire is ~0% tech ex-AAPL, SPY ~1/3 tech.
  Right — the resulting overlay net position per sector. Sectors where the book is
          UNDER-weight vs SPY end up as a LONG ETF leg (negative short), because
          shorting SPY over-imports those sectors and the overlay must add them back.

Data provenance:
  - Berkshire sector weights: REAL — each disclosed position mapped to its GICS sector
    via decompose()'s exposure.sector.hedge_etf, dollar-weighted (charts/risk_detail.json).
  - Overlay per-sector legs: REAL — charts/overlay_data.json etf_shorts, grouped by the
    ETF's GICS sector (positive = short, negative = long).
  - SPY sector weights: PUBLIC REFERENCE constant (S&P 500 GICS weights, approx mid-2020s).
    Clearly labeled as reference — NOT API-derived. The teaching point (the tech gap) is
    robust to a few points of imprecision; exact SPY weights are not available via this API.

Run:  python sdk/portfolio_timeseries/chart_long_etf_explainer.py
"""

from __future__ import annotations

# --- import-order shim (kept for consistency; this script hits no live API) --
import riskmodels  # noqa: E402,F401
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)
# -----------------------------------------------------------------------------

import json

import numpy as np
import matplotlib.pyplot as plt

from portfolio_timeseries import _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
_CHARTS = _HERE / "charts"

# ETF ticker -> GICS sector. Covers every sector/subsector ETF in Berkshire's overlay.
ETF_SECTOR = {
    "XLK": "Information Technology", "RSPT": "Information Technology",
    "IGV": "Information Technology", "VGT": "Information Technology", "FDN": "Information Technology",
    "XLF": "Financials", "IYG": "Financials", "IAI": "Financials", "KIE": "Financials",
    "XLV": "Health Care", "IHF": "Health Care", "IHI": "Health Care",
    "XLY": "Consumer Discretionary", "XRT": "Consumer Discretionary",
    "ITB": "Consumer Discretionary", "XHB": "Consumer Discretionary",
    "XLC": "Communication Services", "VOX": "Communication Services", "GGME": "Communication Services",
    "XLI": "Industrials", "IYJ": "Industrials",
    "XLP": "Consumer Staples", "PBJ": "Consumer Staples", "IYK": "Consumer Staples", "PEJ": "Consumer Discretionary",
    "XLB": "Materials", "XME": "Materials",
    "XLRE": "Real Estate", "VNQ": "Real Estate",
    "XLE": "Energy", "XLU": "Utilities",
}

# S&P 500 (SPY) GICS sector weights — PUBLIC REFERENCE, approximate mid-2020s.
# Normalized to 1.0 below. NOT API-derived (see module docstring).
SPY_REF = {
    "Information Technology": 0.32,
    "Financials": 0.13,
    "Health Care": 0.11,
    "Consumer Discretionary": 0.10,
    "Communication Services": 0.09,
    "Industrials": 0.08,
    "Consumer Staples": 0.06,
    "Energy": 0.035,
    "Utilities": 0.025,
    "Real Estate": 0.022,
    "Materials": 0.020,
}


def book_sector_weights(detail):
    """REAL Berkshire book sector weights via each position's sector ETF.

    Also returns the single largest name's ticker + weight inside each sector, so the
    left panel can show that Berkshire's tech weight is essentially one name (AAPL).
    """
    acc: dict[str, float] = {}
    top_name: dict[str, tuple[str, float]] = {}  # sector -> (ticker, dollars)
    total = 0.0
    for p in detail["positions"]:
        if not p.get("decomposed") or not p.get("dollars"):
            continue
        sec = ETF_SECTOR.get(p.get("sector_etf"))
        if sec is None:
            sec = f"(other: {p.get('sector_etf')})"
        acc[sec] = acc.get(sec, 0.0) + p["dollars"]
        if sec not in top_name or p["dollars"] > top_name[sec][1]:
            top_name[sec] = (p["ticker"], p["dollars"])
        total += p["dollars"]
    weights = {k: v / total for k, v in acc.items()}
    top_w = {k: (t, d / total) for k, (t, d) in top_name.items()}
    return weights, top_w, total


def overlay_sector_legs(overlay):
    """REAL overlay net $ per sector (sum of that sector's ETF legs; + short / - long)."""
    legs: dict[str, float] = {}
    spy = 0.0
    for etf, dollars in overlay["etf_shorts"].items():
        if etf == "SPY":
            spy += dollars
            continue
        sec = ETF_SECTOR.get(etf, f"(other: {etf})")
        legs[sec] = legs.get(sec, 0.0) + dollars
    return legs, spy


def main():
    detail = json.loads((_CHARTS / "risk_detail.json").read_text())["Berkshire"]
    overlay = json.loads((_CHARTS / "overlay_data.json").read_text())["Berkshire"]

    book_w, top_w, _ = book_sector_weights(detail)
    spy_w = {k: v / sum(SPY_REF.values()) for k, v in SPY_REF.items()}
    legs, spy_leg = overlay_sector_legs(overlay)

    # sector order: by SPY weight descending (tech first — the headline gap)
    sectors = sorted(SPY_REF, key=lambda s: -SPY_REF[s])
    # append any book/overlay-only sectors not in SPY_REF
    for s in list(book_w) + list(legs):
        if s not in sectors:
            sectors.append(s)

    fig, (axL, axR) = plt.subplots(1, 2, figsize=(14, 7))

    # ---- Left: book vs SPY sector weights ----------------------------------
    y = np.arange(len(sectors))
    bw = [book_w.get(s, 0.0) * 100 for s in sectors]
    sw = [spy_w.get(s, 0.0) * 100 for s in sectors]
    h = 0.38
    axL.barh(y + h / 2, sw, height=h, color=ck.GREY, label="SPY (S&P 500) — reference")
    # Berkshire book: navy = ex-single-largest-name; hatched = the single largest name.
    # This exposes that the tech weight is essentially just AAPL.
    ti = sectors.index("Information Technology")
    ex_top = []
    for s in sectors:
        tw = book_w.get(s, 0.0) * 100
        topw = top_w.get(s, ("", 0.0))[1] * 100
        ex_top.append(max(tw - topw, 0.0))
    axL.barh(y - h / 2, ex_top, height=h, color=ck.NAVY, label="Berkshire book (ex-largest name)")
    # stack the single-largest-name portion, hatched, for sectors dominated by one name
    top_part = [bw[i] - ex_top[i] for i in range(len(sectors))]
    axL.barh(y - h / 2, top_part, height=h, left=ex_top, color="#7a95bf",
             hatch="///", edgecolor="white", label="largest single name in sector")
    axL.set_yticks(y)
    axL.set_yticklabels(sectors, fontsize=9)
    axL.invert_yaxis()
    axL.set_xlabel("Sector weight (%)")
    axL.text(0.0, 1.06, "Berkshire book vs SPY — sector weights",
             transform=axL.transAxes, fontsize=12, fontweight="bold")
    axL.text(0.0, 1.01, "Book weights API-derived (decompose sector ETF); SPY weights public reference",
             transform=axL.transAxes, fontsize=8, color=ck.GREY_TXT)
    axL.legend(loc="lower right", frameon=False, fontsize=8)
    ck.style_ax(axL)
    axL.grid(axis="y", visible=False)
    # annotate the ex-AAPL tech gap — the real point
    aapl_tkr, aapl_w = top_w.get("Information Technology", ("AAPL", 0.0))
    exaapl_tech = book_w.get("Information Technology", 0.0) - aapl_w
    axL.annotate(f"tech is essentially all {aapl_tkr} ({aapl_w*100:.0f}%);\n"
                 f"ex-{aapl_tkr} ≈ {exaapl_tech*100:.0f}% vs SPY {sw[ti]:.0f}% → SPY short over-imports tech",
                 xy=(ex_top[ti], ti - h / 2), xytext=(sw[ti] + 3, ti + 2.4),
                 fontsize=8, color=ck.ORANGE, ha="left",
                 arrowprops=dict(arrowstyle="->", color=ck.ORANGE, lw=1.2))

    # ---- Right: overlay net position per sector ----------------------------
    leg_vals = [legs.get(s, 0.0) / 1e6 for s in sectors]  # $M
    colors = [ck.RED if v > 0 else ck.GREEN for v in leg_vals]
    axR.barh(y, leg_vals, height=0.6, color=colors)
    axR.set_yticks(y)
    axR.set_yticklabels(sectors, fontsize=9)
    axR.invert_yaxis()
    axR.axvline(0, color="#333333", lw=1.0)
    axR.set_xlabel("Overlay net position ($M)   —   short ▶ (red)   ◀ long (green)")
    axR.text(0.0, 1.06, "Resulting overlay position per sector",
             transform=axR.transAxes, fontsize=12, fontweight="bold")
    axR.text(0.0, 1.01, "Sum of that sector's ETF legs (etf_shorts); + = short, − = long ETF",
             transform=axR.transAxes, fontsize=8, color=ck.GREY_TXT)
    ck.style_ax(axR)
    axR.grid(axis="y", visible=False)
    for yi, v in zip(y, leg_vals):
        if abs(v) < 0.1:
            continue
        axR.text(v + (2 if v >= 0 else -2), yi, ck.money(v * 1e6),
                 va="center", ha="left" if v >= 0 else "right", fontsize=7.5,
                 color=ck.RED if v > 0 else ck.GREEN)

    fig.suptitle("Why long-ETF positions appear in a market-neutral overlay — Berkshire",
                 fontsize=14, fontweight="bold", y=1.0)
    fig.text(0.5, -0.02,
             "Mechanism: shorting SPY imports SPY's sector weights, so any sector where the book is "
             "UNDER-weight vs SPY gets over-hedged — the overlay corrects it with a LONG ETF leg (green).  "
             f"(SPY market leg, shown separately: short {ck.money(spy_leg)}.)",
             ha="center", fontsize=8.5, color=ck.GREY_TXT, style="italic", wrap=True)
    fig.tight_layout(rect=[0, 0.02, 1, 0.96])
    hi, web = ck.save(fig, "long_etf_explainer")
    print("[written]", hi)

    # console summary
    print("\nBerkshire book sector weights (API-derived):")
    for s in sectors:
        print(f"  {s:26s} book {book_w.get(s,0)*100:5.1f}%   SPY(ref) {spy_w.get(s,0)*100:5.1f}%"
              f"   overlay {ck.money(legs.get(s,0))}")

    # caption
    longs = [s for s in sectors if legs.get(s, 0) < -1e5]
    write_caption(book_w, top_w, spy_w, legs, spy_leg, longs)


def write_caption(book_w, top_w, spy_w, legs, spy_leg, longs):
    it = "Information Technology"
    lines = [
        "# Long-ETF Explainer — Berkshire",
        "",
        "**File:** `charts/long_etf_explainer.png` (+ `_web.png`)",
        "",
        "## What it shows",
        "",
        "A two-panel figure that makes the long-ETF phenomenon obvious. **Left:** Berkshire's "
        "book sector weights next to SPY's — with the tech bar split so you can see it is "
        "essentially one name (AAPL). **Right:** the overlay's net position in each sector's ETF "
        "(red = short, green = long).",
        "",
        "## The mechanism (one sentence)",
        "",
        "Shorting SPY imports SPY's sector weights, so where the book carries **less** of a sector "
        "than the SPY short imports, the overlay ends up **long** that sector's ETF to avoid "
        "over-hedging it.",
        "",
        "## Why Berkshire in particular — the tech example",
        "",
        f"Berkshire's book is ~{book_w.get(it,0)*100:.0f}% Information Technology, but that is "
        f"**almost entirely AAPL** ({top_w.get(it,('AAPL',0))[1]*100:.0f}% of the book); ex-AAPL, "
        f"Berkshire holds ~{(book_w.get(it,0)-top_w.get(it,('',0))[1])*100:.0f}% tech vs SPY's "
        f"~{spy_w.get(it,0)*100:.0f}%. When the overlay shorts SPY to kill market beta it imports "
        "SPY's broad, diversified ~1/3 tech weight — which AAPL alone does not match — so the net "
        f"overlay goes **long** the tech ETF ({ck.money(legs.get(it,0))}). Net long-ETF sectors "
        "this quarter: " + (", ".join(longs) if longs else "none") + ".",
        "",
        "## Honest note on construction (bottom-up, not top-down)",
        "",
        "This overlay is built **bottom-up** from each held stock's `decompose()` hedge ratios, "
        "**not** by comparing the book to SPY sector-by-sector. A long ETF leg appears when a "
        "*held* position's sector/subsector beta is more than covered by the SPY short (e.g. AAPL "
        "→ long RSPT). Consequently the overlay does **not** add a long leg for sectors the book "
        "omits entirely: Berkshire holds ~0% Health Care (SPY ~11%), yet the overlay shows $0 in "
        "health-care ETFs because no held name references them. That is a real property of the "
        "current per-position overlay, not an error — worth flagging to Conrad as a design choice "
        "(bottom-up hedge vs. a top-down index-relative hedge).",
        "",
        "## How it was computed",
        "",
        "- **Book sector weights (left, navy + hatched):** each disclosed position mapped to its "
        "GICS sector via `decompose()`'s `exposure.sector.hedge_etf`, dollar-weighted "
        "(`charts/risk_detail.json`). The hatched segment is the single largest name in each "
        "sector. **API-derived.**",
        "- **Overlay legs (right):** `charts/overlay_data.json` `etf_shorts`, grouped by each ETF's "
        "GICS sector; positive = short, negative = long. **API-derived.** SPY market leg "
        f"({ck.money(spy_leg)} short) shown in the footnote, not as a sector.",
        "- **SPY sector weights (left, grey):** **public reference** (S&P 500 GICS weights, approx "
        "mid-2020s), normalized to 100%. **NOT API-derived** — the RiskModels API does not expose "
        "index constituent weights.",
        "",
        "## Caveat",
        "",
        "SPY weights are an approximate public reference, not a live figure; treat the left panel as "
        "illustrative of the *gap*, not a precise index snapshot. Everything about Berkshire's book "
        "and the overlay is real API output.",
    ]
    (_CHARTS / "long_etf_explainer.md").write_text("\n".join(lines) + "\n")
    print("[written] charts/long_etf_explainer.md")


if __name__ == "__main__":
    main()
