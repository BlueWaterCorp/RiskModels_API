"""Deliverable 5 — raw vs hedged across multiple time windows (Berkshire).

2×2 small multiples over 3-, 6-, 12- and 24-month windows (as far back as return
data allows), same methodology as berkshire_raw_vs_hedged.png. Purpose: show the
beta reduction holds across horizons, not just the 12-month sample. Each panel
subtitle reports realized β of the hedged series vs SPY.

Reuses charts/overlay_data.json for the Berkshire overlay (no decompose re-run);
fetches 2y of daily returns once and slices each window. Run:
  python sdk/portfolio_timeseries/chart_multi_window.py
"""

from __future__ import annotations

# --- import-order shim -------------------------------------------------------
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
BERK = "BW-FILER-CIK0001067983"
# (label, approx trading days). None = all available (the 24m panel).
WINDOWS = [("3-month", 63), ("6-month", 126), ("12-month", 252), ("24-month", None)]


def _returns_frame(client, symbols, years=2):
    cols, missing = {}, []
    for s in symbols:
        try:
            df = client.get_ticker_returns(s, years=years)
            ser = pd.Series(df["returns_gross"].values, index=pd.to_datetime(df["date"].values), name=s)
            cols[s] = ser[~ser.index.duplicated(keep="last")]
        except Exception as e:  # noqa: BLE001
            missing.append(s)
    return pd.DataFrame(cols).sort_index(), missing


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    overlay = json.loads((_HERE / "charts" / "overlay_data.json").read_text())["Berkshire"]
    etf_shorts = overlay["etf_shorts"]
    gross_long = overlay["gross_long"]

    pts = PortfolioTimeSeries.from_cik(BERK, client=client)
    snap = pts.as_of(date.today())
    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)

    pos_ret, pos_miss = _returns_frame(client, tickers)
    etf_ret, etf_miss = _returns_frame(client, list(etf_shorts))
    idx = pos_ret.index.intersection(etf_ret.index)
    pos_ret, etf_ret = pos_ret.loc[idx], etf_ret.loc[idx]
    print(f"fetched {len(idx)} trading days ({idx[0].date()} → {idx[-1].date()}); "
          f"missing pos={pos_miss} etf={etf_miss}")

    w = pd.Series(dollars, index=tickers).reindex(pos_ret.columns)
    w = w / w.sum()
    raw = (pos_ret * w).sum(axis=1)
    ov_w = pd.Series(etf_shorts).reindex(etf_ret.columns) / gross_long
    hedged = raw - (etf_ret * ov_w).sum(axis=1)
    spy = etf_ret["SPY"] if "SPY" in etf_ret else None

    fig, axes = plt.subplots(2, 2, figsize=(13, 8))
    max_days = len(idx)
    panel_meta = []
    for ax, (label, ndays) in zip(axes.flat, WINDOWS):
        n = max_days if ndays is None else min(ndays, max_days)
        r, h = raw.iloc[-n:], hedged.iloc[-n:]
        rc = ((1 + r).cumprod() - 1) * 100
        hc = ((1 + h).cumprod() - 1) * 100
        beta = np.nan
        if spy is not None:
            s = spy.iloc[-n:]
            beta = float(np.cov(h.values, s.values)[0, 1] / np.var(s.values))
        raw_beta = np.nan
        if spy is not None:
            s = spy.iloc[-n:]
            raw_beta = float(np.cov(r.values, s.values)[0, 1] / np.var(s.values))

        ax.plot(rc.index, rc.values, color=ck.NAVY, lw=1.8, label="Raw")
        ax.plot(hc.index, hc.values, color=ck.ORANGE, lw=1.8, label="Hedged")
        ax.axhline(0, color=ck.GREY, lw=0.8, zorder=0)
        actual = f"{label}" if ndays and n >= ndays else f"{label} (all {n}d)"
        ax.text(0.0, 1.10, actual, transform=ax.transAxes, fontsize=11, fontweight="bold")
        ax.text(0.0, 1.02, f"hedged β={beta:+.3f}   raw β={raw_beta:+.2f}   "
                f"{rc.index[0].date()}→{rc.index[-1].date()}",
                transform=ax.transAxes, fontsize=8, color=ck.GREY_TXT)
        ax.set_ylabel("Cum. return (%)", fontsize=9)
        ck.style_ax(ax)
        ax.grid(axis="x", visible=False)
        if ax is axes.flat[0]:
            ax.legend(loc="upper left", frameon=False, fontsize=9)
        panel_meta.append((label, n, beta, raw_beta))

    fig.suptitle("Berkshire — raw vs. market-neutral hedged across time windows",
                 fontsize=14, fontweight="bold", y=1.0)
    fig.text(0.5, -0.01, "Same overlay & weights (current book) applied over each window; "
             "realized β of the hedged series vs SPY in each subtitle.",
             ha="center", fontsize=8, color=ck.GREY_TXT, style="italic")
    fig.tight_layout(rect=[0, 0, 1, 0.96], h_pad=3.0)
    hi, web = ck.save(fig, "berkshire_raw_vs_hedged_multi_window")
    print("[written]", hi)
    for label, n, beta, rawb in panel_meta:
        print(f"  {label}: {n}d  hedged β={beta:+.3f}  raw β={rawb:+.2f}")
    (_HERE / "charts" / "multi_window_meta.json").write_text(
        json.dumps({"panels": [{"window": l, "days": n, "hedged_beta": b, "raw_beta": rb}
                                for l, n, b, rb in panel_meta],
                    "start": str(idx[0].date()), "end": str(idx[-1].date())}, indent=2))


if __name__ == "__main__":
    main()
