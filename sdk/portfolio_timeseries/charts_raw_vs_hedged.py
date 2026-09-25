"""Deliverable A — raw vs hedged cumulative-return chart for Berkshire.

Empirical validation of the market-neutral overlay: if the overlay truly zeros
industry-axis exposure, the *hedged* cumulative-return line should drift far less
than the *raw* long-book line, and the hedged series' realized beta to SPY should
sit near zero.

Method:
  raw_t     = Σ_i  w_i · r_i,t                         (disclosed-weight book return)
  hedged_t  = raw_t − Σ_j  (short_j / gross_long) · r_etf_j,t
where short_j are the overlay's signed ETF shorts (positive = short) and r are
daily gross returns from get_ticker_returns. Cumulative series compound daily.

Run:  python sdk/portfolio_timeseries/charts_raw_vs_hedged.py
(imports riskmodels 0.3.11 from site-packages BEFORE adding sdk/ to the path, so
the local 0.3.10 source can't shadow the as_of-capable client.)

NOT a pytest module. Nothing committed.
"""

from __future__ import annotations

# --- import-order shim: load the pip-installed 0.3.11 client first -----------
import riskmodels  # noqa: E402  (resolves site-packages 0.3.11, caches in sys.modules)
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)  # riskmodels already cached, so local 0.3.10 won't shadow
# -----------------------------------------------------------------------------

from datetime import date

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from portfolio_timeseries import MarketNeutralOverlay, PortfolioTimeSeries

BERKSHIRE = "0001067983"
_HERE = Path(__file__).parent
_CHARTS = _HERE / "charts"

# Blue/orange — the canonical CVD-safe categorical pair. Orange (hedged) draws the
# eye to the line that should be flat; navy (raw) recedes.
C_RAW = "#002a5e"
C_HEDGED = "#E07000"


def _returns_frame(client, symbols, years=1):
    """date-indexed DataFrame of daily gross returns, one column per symbol.

    Symbols that fail to resolve (delisted, no coverage) are skipped and reported.
    """
    cols = {}
    missing = []
    for s in symbols:
        try:
            df = client.get_ticker_returns(s, years=years)
            ser = pd.Series(df["returns_gross"].values, index=pd.to_datetime(df["date"].values), name=s)
            cols[s] = ser[~ser.index.duplicated(keep="last")]
        except Exception as e:  # noqa: BLE001
            missing.append((s, f"{type(e).__name__}: {e}"))
    frame = pd.DataFrame(cols).sort_index()
    return frame, missing


def build_series(client):
    pts = PortfolioTimeSeries.from_cik(BERKSHIRE, client=client)
    snap = pts.as_of(date.today())
    tickers = [str(t) for t in snap["ticker"].values]
    dollars = np.asarray(snap["dollars"].values, dtype=float)
    gross_long = float(np.nansum(dollars))

    overlay = MarketNeutralOverlay(snap).construct(client)
    etf_shorts = overlay.etf_shorts  # etf -> signed dollars (positive = short)

    # --- fetch returns -------------------------------------------------------
    pos_ret, pos_missing = _returns_frame(client, tickers)
    etf_ret, etf_missing = _returns_frame(client, list(etf_shorts))

    # Align both to a common trading-day index (past 12 months).
    idx = pos_ret.index.intersection(etf_ret.index)
    pos_ret, etf_ret = pos_ret.loc[idx], etf_ret.loc[idx]

    # --- weights -------------------------------------------------------------
    w = pd.Series(dollars, index=tickers).reindex(pos_ret.columns)
    w = w / w.sum()  # renormalize over positions that actually have returns
    raw = (pos_ret * w).sum(axis=1)

    ov_w = pd.Series(etf_shorts).reindex(etf_ret.columns) / gross_long
    hedge_leg = (etf_ret * ov_w).sum(axis=1)
    hedged = raw - hedge_leg

    # realized beta of hedged daily returns vs SPY
    beta = np.nan
    if "SPY" in etf_ret.columns:
        spy = etf_ret["SPY"]
        beta = float(np.cov(hedged.values, spy.values)[0, 1] / np.var(spy.values))
    raw_beta = np.nan
    if "SPY" in etf_ret.columns:
        raw_beta = float(np.cov(raw.values, etf_ret["SPY"].values)[0, 1] / np.var(etf_ret["SPY"].values))

    return {
        "raw": raw, "hedged": hedged, "beta": beta, "raw_beta": raw_beta,
        "gross_long": gross_long, "n_pos": len(pos_ret.columns), "n_etf": len(etf_ret.columns),
        "pos_missing": pos_missing, "etf_missing": etf_missing,
        "report_date": str(snap["report_date"].values)[:10],
        "start": str(idx[0].date()), "end": str(idx[-1].date()), "n_days": len(idx),
        "etf_shorts": etf_shorts,
    }


def render(data, out_png, dpi=150, web=False):
    raw_cum = (1 + data["raw"]).cumprod() - 1
    hed_cum = (1 + data["hedged"]).cumprod() - 1

    if web:
        fig_w = min(1600 / 72, 10.0)  # cap width at 1600px @72dpi
        figsize = (fig_w, fig_w * 0.5)
    else:
        figsize = (11, 5.5)
    fig, ax = plt.subplots(figsize=figsize)

    x = raw_cum.index
    ax.plot(x, raw_cum.values * 100, color=C_RAW, lw=2, label="Raw long book")
    ax.plot(x, hed_cum.values * 100, color=C_HEDGED, lw=2, label="Hedged (industry-axis overlay)")
    ax.axhline(0, color="#999999", lw=0.8, zorder=0)

    ax.set_ylabel("Cumulative return (%)")
    fig.suptitle("Berkshire 13F long book — raw vs. market-neutral hedged",
                 fontsize=13, fontweight="bold", y=0.98)
    sub = (f"Realized β of hedged vs SPY = {data['beta']:+.3f}  "
           f"(raw β = {data['raw_beta']:+.2f})   ·   "
           f"{data['start']} → {data['end']}  ·  {data['n_pos']} positions, {data['n_etf']} ETFs")
    ax.set_title(sub, fontsize=9, color="#444444", pad=10)

    ax.legend(loc="upper left", frameon=False, fontsize=10)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color="#e6e6e6", lw=0.6)
    ax.set_axisbelow(True)
    fig.tight_layout()

    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    return out_png


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    data = build_series(client)

    print("=" * 68)
    print(f"Berkshire book (report {data['report_date']}): gross long ${data['gross_long']:,.0f}")
    print(f"Window: {data['start']} → {data['end']} ({data['n_days']} trading days)")
    print(f"Positions with returns: {data['n_pos']} · ETFs with returns: {data['n_etf']}")
    if data["pos_missing"]:
        print("Positions MISSING returns:", data["pos_missing"])
    if data["etf_missing"]:
        print("ETFs MISSING returns:", data["etf_missing"])
    raw_cum = (1 + data["raw"]).cumprod().iloc[-1] - 1
    hed_cum = (1 + data["hedged"]).cumprod().iloc[-1] - 1
    print(f"Cumulative raw:    {raw_cum:+.2%}")
    print(f"Cumulative hedged: {hed_cum:+.2%}")
    print(f"Realized beta hedged vs SPY: {data['beta']:+.4f}  (raw beta {data['raw_beta']:+.3f})")

    hi = render(data, _CHARTS / "berkshire_raw_vs_hedged.png", dpi=150)
    lo = render(data, _CHARTS / "berkshire_raw_vs_hedged_web.png", dpi=72, web=True)
    print("[written]", hi)
    print("[written]", lo)


if __name__ == "__main__":
    main()
