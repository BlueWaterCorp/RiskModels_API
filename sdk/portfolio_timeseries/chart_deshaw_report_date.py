"""Task 6 — charts for the D. E. Shaw report-date window study.

Reads deshaw_report_date.csv (per-quarter windows) + cache/deshaw_report_date_results.json
(aggregates + control distribution). Produces, in the house style (_chartkit):

  1. report_date_window_timeseries  — +1..10 book return per quarter, SPY over same window overlaid
  2. report_date_window_cumulative  — cumulative compounding of the per-quarter +1..10 returns vs SPY
  3. report_date_layer_split        — window A / E layer means stacked (only if layers validated)
  4. report_date_control_distribution — post-report +1..10 vs typical 10-day windows (same quarter)

CHARACTERISATION, NOT TRADEABLE: the +1..10 window sits ~45 days before the book is public.
Every caption says so. Each chart writes a .md caption file alongside the PNG.
"""
from __future__ import annotations
import sys, json
from pathlib import Path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import _chartkit as ck

CSV = _HERE / "deshaw_report_date.csv"
RES = _HERE / "cache" / "deshaw_report_date_results.json"
CAP = ck.CHARTS_DIR


def _caption(stem, text):
    (CAP / f"{stem}.md").write_text(text.strip() + "\n")


def load():
    df = pd.read_csv(CSV, parse_dates=["report_date"]).sort_values("report_date")
    res = json.load(open(RES))
    return df, res


def chart_timeseries(df, res):
    d = df.dropna(subset=["A_1_10_port"])
    fig, ax = plt.subplots(figsize=(11, 4.5))
    x = d["report_date"]
    ax.bar(x, d["A_1_10_port"] * 100, width=60, color=ck.NAVY, label="D.E.Shaw book (+1..+10d)", zorder=3)
    ax.plot(x, d["A_1_10_spy"] * 100, color=ck.ORANGE, lw=1.6, marker="o", ms=3,
            label="SPY, same window", zorder=4)
    ax.axhline(0, color=ck.GREY, lw=0.8)
    ck.style_ax(ax)
    ax.set_ylabel("10-day return (%)")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    s = res["windows"]["A_1_10"]
    ck.titles(fig, ax, "D. E. Shaw — return in the 10 trading days after each report date",
              f"Disclosed book, days +1..+10 after quarter-end · n={s['port']['n']} quarters · "
              f"mean {s['port']['mean_bps']:.0f}bps t={s['port']['t']:.2f} · "
              f"NOT tradeable (book not public until ~+45d) · characterisation only")
    ck.save(fig, "deshaw_report_date_timeseries")
    _caption("deshaw_report_date_timeseries", f"""
**D. E. Shaw — post-report-date 10-day return per quarter.** Each navy bar is the disclosed
book's return over trading days +1..+10 after the quarter-end report date; the orange line is
SPY over the identical window. n={s['port']['n']} quarters ({res['stage0']['studiable_range'][0]}
..{res['stage0']['studiable_range'][1]}). Coverage median {res['coverage']['median']:.0%} of book
weight (names in the ERM3 3000 universe). **This window is a CHARACTERISATION of how the firm
positions into quarter-end — it is NOT tradeable**, because the book is not public until ~45
calendar days later. Mean {s['port']['mean_bps']:.0f} bps, t={s['port']['t']:.2f},
excess over SPY {s['excess']['mean_bps']:.0f} bps (t={s['excess']['t']:.2f}).
""")


def chart_cumulative(df, res):
    d = df.dropna(subset=["A_1_10_port", "A_1_10_spy"])
    cp = np.cumprod(1 + d["A_1_10_port"].values) - 1
    cs = np.cumprod(1 + d["A_1_10_spy"].values) - 1
    fig, ax = plt.subplots(figsize=(11, 4.5))
    ax.plot(d["report_date"], cp * 100, color=ck.NAVY, lw=2, label="D.E.Shaw book (+1..+10d)")
    ax.plot(d["report_date"], cs * 100, color=ck.ORANGE, lw=2, label="SPY, same windows")
    ax.axhline(0, color=ck.GREY, lw=0.8)
    ck.style_ax(ax)
    ax.set_ylabel("cumulative return (%)")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    ck.titles(fig, ax, "D. E. Shaw — cumulative of the post-report 10-day windows",
              "Compounding only the +1..+10d post-report windows (≈10 trading days per quarter, "
              "not continuous holding) · characterisation, not a tradeable P&L")
    ck.save(fig, "deshaw_report_date_cumulative")
    _caption("deshaw_report_date_cumulative", """
**Cumulative post-report window return.** Compounds the per-quarter +1..+10d returns (navy) and
SPY over the same windows (orange). NOTE this chains ~10-trading-day slices, one per quarter — it
is NOT a continuously-held portfolio and NOT a tradeable series (the window is pre-disclosure).
It shows whether the post-report pattern is persistent or episodic over the full studiable history.
""")


def chart_layer_split(df, res):
    if not res.get("layer_validation_pass"):
        _caption("deshaw_report_date_layer_split",
                 "Layer split NOT charted — the decomposition failed its validation gate "
                 "against the endpoint's unlagged quarterly layer returns. See DESHAW_REPORT_DATE.md §3.")
        return
    layers = ["market", "sector", "subsector", "idio"]
    colors = [ck.NAVY, "#006f8e", "#2a7fbf", ck.ORANGE]
    wins = [("A_1_10", "+1..+10 (ask)"), ("E_45_55", "+45..+55 (post-public)")]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    xs = np.arange(len(wins))
    bottoms_pos = np.zeros(len(wins)); bottoms_neg = np.zeros(len(wins))
    for li, lay in enumerate(layers):
        vals = np.array([res["layers"][w[0]][lay]["mean_bps"] for w in wins])
        base = np.where(vals >= 0, bottoms_pos, bottoms_neg)
        ax.bar(xs, vals, bottom=base, color=colors[li], label=lay, width=0.5, zorder=3)
        bottoms_pos = bottoms_pos + np.where(vals >= 0, vals, 0)
        bottoms_neg = bottoms_neg + np.where(vals < 0, vals, 0)
    ax.axhline(0, color=ck.GREY, lw=0.8)
    ax.set_xticks(xs); ax.set_xticklabels([w[1] for w in wins])
    ck.style_ax(ax)
    ax.set_ylabel("mean layer contribution (bps)")
    ax.legend(frameon=False, fontsize=8, ncol=4, loc="upper center")
    ck.titles(fig, ax, "D. E. Shaw — layer split of the post-report window",
              "Is the post-report move market beta, sector positioning, or stock selection (idio)?")
    ck.save(fig, "deshaw_report_date_layer_split")
    _caption("deshaw_report_date_layer_split", """
**Layer decomposition of the post-report window.** Each bar splits the mean window return into
the four orthogonal ERM3 layers (market / sector / subsector / idiosyncratic) via
get_returns_decomposition, validated against the endpoint's unlagged quarterly layer returns.
Answers whether the post-report performance is market beta, sector positioning, or genuine stock
selection. Characterisation only; coverage-limited (see caption of the time-series chart).
""")


def chart_control_distribution(df, res):
    ctrl = res["control"]
    # rebuild pooled samples from the CSV for the histogram: post-report A vs later-quarter windows
    # (the results JSON stores aggregate stats; we visualise the per-quarter A distribution vs SPY-null)
    a = df["A_1_10_port"].dropna().values * 100
    # control mean per quarter isn't in the CSV; use the aggregate control mean/std as a normal ref band
    cm = ctrl["control_pooled"]["mean_bps"] / 100
    cs = ctrl["control_pooled"]["std_bps"] / 100
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.hist(a, bins=18, color=ck.NAVY, alpha=0.8, label="post-report +1..+10d (per quarter)", zorder=3)
    ax.axvline(a.mean(), color=ck.NAVY, lw=2, ls="--", label=f"post-report mean {a.mean():.2f}%")
    ax.axvline(cm, color=ck.ORANGE, lw=2, ls="--",
               label=f"typical 10-day window mean {cm:.2f}%")
    ck.style_ax(ax)
    ax.set_xlabel("10-day return (%)")
    ax.set_ylabel("count of quarters")
    ax.legend(frameon=False, fontsize=8)
    pd_ = ctrl["paired_diff"]
    ck.titles(fig, ax, "D. E. Shaw — post-report window vs a typical 10-day window",
              f"Paired (A − same-quarter control mean): {pd_['mean_bps']:.0f}bps t={pd_['t']:.2f} · "
              f"post-report sits at the {ctrl['mean_percentile']:.0f}th percentile of its quarter's windows")
    ck.save(fig, "deshaw_report_date_control_distribution")
    _caption("deshaw_report_date_control_distribution", f"""
**Post-report window vs a typical 10-day window (same quarter, same book).** Navy histogram: the
per-quarter +1..+10d return. Dashed navy = its mean; dashed orange = the mean of control 10-day
windows drawn from later in the same quarter (days +11..+50). The control is the whole point: a
good book does well in most windows, so the post-report window only matters if it is DISTINGUISHABLE
from an ordinary one. Paired difference (A minus that quarter's control mean):
{pd_['mean_bps']:.0f} bps, t={pd_['t']:.2f}, hit {pd_['hit']:.0f}%. Mean percentile of the
post-report window within its quarter's control set: {ctrl['mean_percentile']:.0f}th.
""")


def main():
    df, res = load()
    chart_timeseries(df, res)
    chart_cumulative(df, res)
    chart_layer_split(df, res)
    chart_control_distribution(df, res)
    print("wrote 4 charts to", CAP)


if __name__ == "__main__":
    main()
