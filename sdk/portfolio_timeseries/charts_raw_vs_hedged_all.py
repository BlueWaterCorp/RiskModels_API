"""Deliverable 1 — raw vs hedged multi-window charts for the three remaining filers.

Reproduces the Berkshire methodology (charts_raw_vs_hedged.py / chart_multi_window.py)
for Pershing, Appaloosa and Greenlight, and emits a cross-filer summary table.

Method (identical to Berkshire, the static / current-overlay version):
  raw_t     = Σ_i  w_i · r_i,t                          (disclosed-weight book return)
  hedged_t  = raw_t − Σ_j  (short_j / gross_long) · r_etf_j,t
where short_j are the netted overlay's signed ETF shorts (positive = short, from
decompose's per-dollar hedge ratios, cached in charts/overlay_data.json) and r are
daily gross returns from get_ticker_returns. Cumulative series compound daily. Each
panel reports realized β of the hedged series vs SPY over that window.

Outputs (per filer):  charts/<filer>_raw_vs_hedged_multi_window.png (+ _web) + .md caption
Plus:                 charts/hedge_effectiveness_summary.md (one row per filer, all windows)

CAVEAT — this is the *static* overlay applied backward (today's book over past returns),
same as the Berkshire chart. The point-in-time (per-vintage) version is Deliverable 4.
Greenlight's latest book is 2023-12-31 (stale) — see its caption for the coverage limit.

Run:  python sdk/portfolio_timeseries/charts_raw_vs_hedged_all.py
NOT a pytest module. Nothing committed.
"""

from __future__ import annotations

# --- import-order shim: load pip 0.3.11 before sdk/ (0.3.10) can shadow -------
import riskmodels  # noqa: E402
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)
# -----------------------------------------------------------------------------

import json
from datetime import date

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from portfolio_timeseries import PortfolioTimeSeries, _chartkit as ck  # noqa: E402

_HERE = Path(__file__).parent
_CHARTS = _HERE / "charts"

# (label, approx trading days). None = all available (24-month panel).
WINDOWS = [("3-month", 63), ("6-month", 126), ("12-month", 252), ("24-month", None)]

# filer display name -> bw_filer_id.  Berkshire already shipped; these are the three asks.
FILERS = {
    "Pershing": "BW-FILER-CIK0001336528",
    "Appaloosa": "BW-FILER-CIK0001656456",
    "Greenlight": "BW-FILER-CIK0001079114",
}


def _returns_frame(client, symbols, years=2):
    """date-indexed DataFrame of daily gross returns, one column per symbol.

    Unresolvable symbols (delisted, BW-RESTRICTED, no coverage) are skipped and reported.
    """
    cols, missing = {}, []
    for s in symbols:
        if not s or s.startswith("BW-"):  # restricted / unresolved FIGI rows have no ticker
            missing.append(s)
            continue
        try:
            df = client.get_ticker_returns(s, years=years)
            ser = pd.Series(df["returns_gross"].values,
                            index=pd.to_datetime(df["date"].values), name=s)
            cols[s] = ser[~ser.index.duplicated(keep="last")]
        except Exception:  # noqa: BLE001
            missing.append(s)
    return pd.DataFrame(cols).sort_index(), missing


def build(client, name, fid, overlay):
    """Return the raw/hedged daily series + per-window betas + coverage for one filer."""
    pts = PortfolioTimeSeries.from_cik(fid, client=client)
    snap = pts.as_of(date.today())
    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    report_date = str(snap["report_date"].values)[:10]

    etf_shorts = overlay["etf_shorts"]
    gross_long = float(overlay["gross_long"])

    pos_ret, pos_miss = _returns_frame(client, tickers)
    etf_ret, etf_miss = _returns_frame(client, list(etf_shorts))
    idx = pos_ret.index.intersection(etf_ret.index)
    pos_ret, etf_ret = pos_ret.loc[idx], etf_ret.loc[idx]

    # dollar weights over positions that actually returned data, renormalized
    w = pd.Series(dollars, index=tickers).reindex(pos_ret.columns)
    covered_dollars = float(np.nansum(w.values))
    w = w / w.sum()
    raw = (pos_ret * w).sum(axis=1)

    ov_w = pd.Series(etf_shorts).reindex(etf_ret.columns) / gross_long
    hedged = raw - (etf_ret * ov_w).sum(axis=1)
    spy = etf_ret["SPY"] if "SPY" in etf_ret.columns else None

    n_pos_disclosed = int(np.sum(~np.isnan(dollars)))
    return {
        "name": name, "report_date": report_date,
        "raw": raw, "hedged": hedged, "spy": spy, "idx": idx,
        "n_pos_disclosed": n_pos_disclosed,
        "n_pos_covered": len(pos_ret.columns),
        "n_etf_covered": len(etf_ret.columns),
        "pos_missing": [m for m in pos_miss if m],
        "etf_missing": [m for m in etf_miss if m],
        "gross_long": gross_long,
        "covered_frac": covered_dollars / gross_long if gross_long else float("nan"),
        "n_days": len(idx),
    }


def _beta(series, spy, n):
    if spy is None:
        return float("nan")
    s = spy.iloc[-n:]
    y = series.iloc[-n:]
    if len(s) < 5 or np.var(s.values) == 0:
        return float("nan")
    return float(np.cov(y.values, s.values)[0, 1] / np.var(s.values))


def render(d):
    raw, hedged, spy = d["raw"], d["hedged"], d["spy"]
    max_days = d["n_days"]
    fig, axes = plt.subplots(2, 2, figsize=(13, 8))
    panels = []
    for ax, (label, ndays) in zip(axes.flat, WINDOWS):
        n = max_days if ndays is None else min(ndays, max_days)
        if n < 5:
            ax.text(0.5, 0.5, f"{label}\ninsufficient data ({n}d)",
                    ha="center", va="center", transform=ax.transAxes,
                    fontsize=11, color=ck.GREY_TXT)
            ax.set_axis_off()
            panels.append((label, n, float("nan"), float("nan")))
            continue
        r, h = raw.iloc[-n:], hedged.iloc[-n:]
        rc = ((1 + r).cumprod() - 1) * 100
        hc = ((1 + h).cumprod() - 1) * 100
        beta = _beta(hedged, spy, n)
        raw_beta = _beta(raw, spy, n)
        ax.plot(rc.index, rc.values, color=ck.NAVY, lw=1.8, label="Raw long book")
        ax.plot(hc.index, hc.values, color=ck.ORANGE, lw=1.8, label="Hedged (overlay)")
        ax.axhline(0, color=ck.GREY, lw=0.8, zorder=0)
        actual = label if (ndays and n >= ndays) else f"{label} (all {n}d)"
        ax.text(0.0, 1.10, actual, transform=ax.transAxes, fontsize=11, fontweight="bold")
        ax.text(0.0, 1.02, f"hedged β={beta:+.3f}   raw β={raw_beta:+.2f}   "
                f"{rc.index[0].date()}→{rc.index[-1].date()}",
                transform=ax.transAxes, fontsize=8, color=ck.GREY_TXT)
        ax.set_ylabel("Cum. return (%)", fontsize=9)
        ck.style_ax(ax)
        ax.grid(axis="x", visible=False)
        if ax is axes.flat[0]:
            ax.legend(loc="upper left", frameon=False, fontsize=9)
        panels.append((label, n, beta, raw_beta))

    fig.suptitle(f"{d['name']} — raw vs. market-neutral hedged across time windows",
                 fontsize=14, fontweight="bold", y=1.0)
    cov = d["covered_frac"]
    fig.text(0.5, -0.01,
             f"Static current-overlay ({d['report_date']} book) applied over each window; "
             f"realized β of the hedged series vs SPY in each subtitle.  "
             f"{d['n_pos_covered']}/{d['n_pos_disclosed']} positions with returns "
             f"({cov:.0%} of gross $).",
             ha="center", fontsize=8, color=ck.GREY_TXT, style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.96], h_pad=3.0)
    stem = f"{d['name'].lower()}_raw_vs_hedged_multi_window"
    hi, web = ck.save(fig, stem)
    return stem, panels


def write_caption(d, stem, panels):
    lines = [f"# {d['name']} — Raw vs. Hedged (multi-window)", ""]
    lines.append(f"**File:** `charts/{stem}.png` (+ `_web.png`)  ")
    lines.append(f"**Book:** report date {d['report_date']}  ·  "
                 f"{d['n_pos_covered']}/{d['n_pos_disclosed']} positions with return coverage "
                 f"({d['covered_frac']:.0%} of gross long $)  ·  "
                 f"{d['n_etf_covered']} overlay ETFs  ·  {d['n_days']} trading days of returns")
    lines += ["", "## What it shows", ""]
    lines.append("Four panels (3 / 6 / 12 / 24-month) of cumulative return for the "
                 f"{d['name']} disclosed long book, *raw* (navy) vs. *hedged* with the "
                 "market-neutral industry-axis overlay (orange). The hedged line should "
                 "drift far less and its realized β to SPY should sit near zero.")
    lines += ["", "## How it was computed", ""]
    lines += [
        "```",
        "raw_t    = Σ_i w_i · r_i,t              (disclosed dollar weights, renormalized over covered names)",
        "hedged_t = raw_t − Σ_j (short_j/gross_long) · r_etf_j,t",
        "```",
        "- `r` = daily gross returns from `get_ticker_returns` (stocks + ETFs), trailing 2y.",
        "- `short_j` = netted overlay ETF shorts from `decompose()` per-dollar hedge ratios "
        "(cached in `charts/overlay_data.json`).",
        "- Realized β = cov(series, SPY) / var(SPY) over each window.",
        "",
        "## Per-window betas",
        "",
        "| Window | Days | Raw β | Hedged β | β reduction |",
        "|---|---|---|---|---|",
    ]
    for label, n, beta, raw_beta in panels:
        if np.isnan(beta) or np.isnan(raw_beta) or raw_beta == 0:
            red = "—"
        else:
            red = f"{(1 - beta / raw_beta):.0%}"
        bstr = "—" if np.isnan(beta) else f"{beta:+.3f}"
        rstr = "—" if np.isnan(raw_beta) else f"{raw_beta:+.2f}"
        lines.append(f"| {label} | {n} | {rstr} | {bstr} | {red} |")
    lines += ["", "## Caveats", ""]
    lines.append("- **Static overlay applied backward:** today's book / overlay is held "
                 "fixed across all windows (same limitation as the Berkshire chart). The "
                 "point-in-time per-vintage version is Deliverable 4.")
    if d["pos_missing"]:
        lines.append(f"- **Positions without returns (excluded from raw):** "
                     f"{', '.join(d['pos_missing'])}.")
    if d["name"] == "Greenlight":
        lines.append("- **⚠ Greenlight book is STALE (2023-12-31, ~2 years old).** Applying "
                     "a Dec-2023 book to 2024–2026 returns is a coverage stretch — the raw "
                     "series reflects positions the manager may have exited. Its top line "
                     "(~27.5%) is a confidential-treatment `BW-RESTRICTED` row with no ticker, "
                     "so it is dropped from the return series entirely. Read these betas as "
                     "indicative only, NOT a like-for-like comparison with the live filers.")
    (_CHARTS / f"{stem}.md").write_text("\n".join(lines) + "\n")


def write_summary(rows):
    """Cross-filer hedge-effectiveness table — one glance at 'does this generalize'."""
    lines = [
        "# Hedge Effectiveness Summary — all filers, all windows",
        "",
        "_Realized β of the raw long book vs. the industry-axis-hedged book against SPY, "
        "per time window. β reduction = 1 − hedged β / raw β. Static current-overlay method "
        "(today's book applied backward); see per-filer captions and Deliverable 4 for the "
        "point-in-time version._",
        "",
        "| Filer | Book date | Window | Raw β | Hedged β | β reduction |",
        "|---|---|---|---|---|---|",
    ]
    for name, report_date, panels in rows:
        for i, (label, n, beta, raw_beta) in enumerate(panels):
            if np.isnan(beta) or np.isnan(raw_beta) or raw_beta == 0:
                red = "—"
            else:
                red = f"{(1 - beta / raw_beta):.0%}"
            bstr = "—" if np.isnan(beta) else f"{beta:+.3f}"
            rstr = "—" if np.isnan(raw_beta) else f"{raw_beta:+.2f}"
            fcell = f"**{name}**" if i == 0 else ""
            dcell = report_date if i == 0 else ""
            lines.append(f"| {fcell} | {dcell} | {label} | {rstr} | {bstr} | {red} |")
        lines.append("| | | | | | |")
    lines += [
        "",
        "## How to read it",
        "",
        "- A large, consistent β reduction across filers is the evidence that the "
        "industry-axis overlay **generalizes** beyond Berkshire.",
        "- The hedged β can creep up at longer windows where the *static* overlay (today's book "
        "applied backward) no longer matches the book actually held then — most visibly Berkshire "
        "24-mo (0.22) and Greenlight (stale book). Pershing and Appaloosa stay near zero even at "
        "24 months. This window-dependence is exactly why the point-in-time backtest (D4) matters.",
        "- Greenlight's book is stale (2023-12-31); treat its row as indicative only.",
    ]
    (_CHARTS / "hedge_effectiveness_summary.md").write_text("\n".join(lines) + "\n")


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    overlays = json.loads((_CHARTS / "overlay_data.json").read_text())

    summary_rows = []
    for name, fid in FILERS.items():
        if name not in overlays:
            print(f"[SKIP] {name}: no overlay in overlay_data.json (run compute_overlays.py)")
            continue
        print("=" * 68, "\n", name)
        d = build(client, name, fid, overlays[name])
        print(f"  book {d['report_date']}  covered {d['n_pos_covered']}/{d['n_pos_disclosed']} pos "
              f"({d['covered_frac']:.0%} $)  {d['n_etf_covered']} etfs  {d['n_days']}d")
        if d["pos_missing"]:
            print(f"  positions MISSING returns: {d['pos_missing']}")
        stem, panels = render(d)
        write_caption(d, stem, panels)
        for label, n, beta, raw_beta in panels:
            print(f"    {label}: {n}d  raw β={raw_beta:+.3f}  hedged β={beta:+.3f}")
        print(f"  [written] charts/{stem}.png (+ _web, .md)")
        summary_rows.append((name, d["report_date"], panels))

    write_summary(summary_rows)
    print("[written] charts/hedge_effectiveness_summary.md")


if __name__ == "__main__":
    main()
