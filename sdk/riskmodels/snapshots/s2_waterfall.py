"""S2 Snapshot — Attribution Waterfall (History × Stock).

Shows how a single stock's L3 risk attribution has evolved over trailing 1 year.
Three panels built from the daily l3_decomposition time series.

Layout (Letter Landscape)
--------------------------
  Header strip  : ticker, company name, subsector ETF, date range
  Chip bar      : latest L3 metrics summary
  Top left      : Stacked area — ER attribution over time (Mkt/Sec/Sub/Res bands)
  Top right     : Hedge ratio time series — L3 β lines (Mkt/Sec/Sub)
  Bottom full   : Cumulative explained-return attribution by factor (bar)

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots import get_data_for_s2, render_s2_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_s2("AAPL", client)
    render_s2_to_pdf(data, "AAPL_S2_Waterfall.pdf")

Fetch/render separation
-----------------------
    get_data_for_s2()  — all API calls happen here (RiskModelsClient only)
    render_s2_to_pdf() — pure Matplotlib + Jinja2, no network calls

Requires
--------
    pip install riskmodels-py[pdf]
"""

from __future__ import annotations

import base64
import datetime
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.dates as mdates
import numpy as np
import pandas as pd

from ..visuals.styles import (
    CN_NAVY, CN_TEAL, CN_SLATE, CN_GREEN, CN_ORANGE, CN_GRAY, CN_LIGHT_BG,
    CN_L3_LAYER_COLORS,
)
from ._base_template import BASE_HTML

# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class S2Data:
    """All data needed to render the S2 Attribution Waterfall snapshot.

    Produced by get_data_for_s2(). Consumed by render_s2_to_pdf().
    No API calls happen after this object is created.
    """
    ticker: str
    company_name: str
    teo: str                          # latest data-as-of date (ISO string)
    date_start: str                   # earliest date in the history window
    universe: str
    history: pd.DataFrame             # l3_decomposition time series (date-indexed)
    metrics: dict[str, Any]           # latest snapshot metrics (semantic keys)
    meta: dict[str, Any]              # symbol-level metadata (sector_etf, subsector_etf, …)
    years: float = 1.0                # trailing window that was requested
    sdk_version: str = "0.3.0"


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------

def get_data_for_s2(
    ticker: str,
    client: Any,
    *,
    years: float = 1.0,
) -> S2Data:
    """Fetch everything needed for the S2 Attribution Waterfall snapshot.

    Makes 2 API calls:
      1. GET /api/metrics/{ticker}          → latest metrics + meta for chip bar
      2. GET /api/l3-decomposition/{ticker} → daily ER/HR time series

    Parameters
    ----------
    ticker : Stock ticker (e.g. "AAPL").
    client : RiskModelsClient instance.
    years  : Trailing window to display (default 1.0 = ~252 trading days).
    """
    # 1. Latest metrics for chip bar and header metadata
    snap_df = client.get_metrics(ticker, as_dataframe=True)
    if snap_df.empty:
        raise ValueError(f"No metrics returned for {ticker}")

    row = snap_df.iloc[0].to_dict()
    teo = str(row.get("teo") or row.get("date") or "N/A")[:10]
    meta = {
        k: row.get(k)
        for k in ["symbol", "ticker", "sector_etf", "subsector_etf", "name", "universe"]
    }
    company_name = str(meta.get("name") or ticker)
    universe = str(row.get("universe") or "uni_mc_3000")

    # 2. Historical L3 decomposition time series via get_ticker_returns
    # (get_l3_decomposition is a future endpoint; get_ticker_returns carries the
    # same l3_market_hr / l3_*_er columns on a daily basis)
    trading_years = max(1, int(round(years + 0.5)))  # round up for the API call
    hist_df = client.get_ticker_returns(ticker, years=trading_years)
    if hist_df.empty:
        raise ValueError(f"No history returned for {ticker}")

    # Trim to requested window (tail of the time series)
    trading_days = int(round(years * 252))
    if len(hist_df) > trading_days:
        hist_df = hist_df.tail(trading_days).copy()

    hist_df = hist_df.reset_index(drop=True)
    date_start = str(hist_df["date"].iloc[0])[:10] if not hist_df.empty else teo

    return S2Data(
        ticker=ticker.upper(),
        company_name=company_name,
        teo=teo,
        date_start=date_start,
        universe=universe,
        history=hist_df,
        metrics=row,
        meta=meta,
        years=years,
    )


# ---------------------------------------------------------------------------
# Chart builders (Matplotlib → base64 PNG)
# ---------------------------------------------------------------------------

def _parse_dates(history: pd.DataFrame) -> pd.DatetimeIndex:
    """Convert the 'date' column to a DatetimeIndex for plotting."""
    return pd.to_datetime(history["date"])


def _chart_er_stacked_area(history: pd.DataFrame, ticker: str) -> str:
    """Top-left: stacked area showing ER attribution over time.

    Positive ER components fill upward, negative fill downward.
    Uses the standard Consultant Navy L3 colour mapping.
    """
    fig, ax = plt.subplots(figsize=(5.5, 4.0))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.set_facecolor("white")

    dates = _parse_dates(history)

    components = [
        ("Market",    "l3_market_er",    CN_NAVY),
        ("Sector",    "l3_sector_er",    CN_TEAL),
        ("Subsector", "l3_subsector_er", CN_SLATE),
        ("Residual",  "l3_residual_er",  CN_GREEN),
    ]

    series: list[np.ndarray] = []
    labels: list[str] = []
    colors: list[str] = []
    for label, col, color in components:
        vals = pd.to_numeric(history.get(col, pd.Series(dtype=float)), errors="coerce").fillna(0.0)
        series.append(vals.values * 100)   # convert to %
        labels.append(label)
        colors.append(color)

    # Separate positive and negative parts for clean stacking
    pos_stack = np.zeros(len(dates))
    neg_stack = np.zeros(len(dates))
    legend_patches: list[mpatches.Patch] = []

    for vals, label, color in zip(series, labels, colors):
        pos = np.where(vals > 0, vals, 0.0)
        neg = np.where(vals < 0, vals, 0.0)
        ax.fill_between(dates, pos_stack, pos_stack + pos,
                        alpha=0.85, color=color, linewidth=0)
        ax.fill_between(dates, neg_stack, neg_stack + neg,
                        alpha=0.85, color=color, linewidth=0)
        pos_stack += pos
        neg_stack += neg
        legend_patches.append(mpatches.Patch(color=color, label=label))

    # Zero line
    ax.axhline(0, color=CN_GRAY, linewidth=0.8, linestyle="--")

    ax.set_ylabel("Annualised ER (%)", fontsize=8, color=CN_GRAY)
    ax.set_title(f"{ticker}  ·  L3 ER Attribution (Trailing History)",
                 fontsize=9, color=CN_NAVY, fontweight="bold", pad=6)

    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right", fontsize=7)
    ax.tick_params(axis="y", labelsize=7)

    ax.legend(handles=legend_patches, fontsize=7, loc="upper left",
              framealpha=0.8, ncol=2)
    ax.grid(True, axis="y", linestyle="--", linewidth=0.4, alpha=0.5)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    plt.tight_layout(pad=1.2)
    return _fig_to_b64(fig)


def _chart_hr_time_series(history: pd.DataFrame, ticker: str) -> str:
    """Top-right: L3 hedge ratio lines (Mkt β / Sec β / Sub β) over time."""
    fig, ax = plt.subplots(figsize=(5.5, 4.0))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.set_facecolor("white")

    dates = _parse_dates(history)

    hr_series = [
        ("Mkt β (L3)", "l3_market_hr",    CN_NAVY, "-"),
        ("Sec β (L3)", "l3_sector_hr",     CN_TEAL, "--"),
        ("Sub β (L3)", "l3_subsector_hr",  CN_SLATE, "-."),
    ]

    for label, col, color, ls in hr_series:
        vals = pd.to_numeric(history.get(col, pd.Series(dtype=float)), errors="coerce")
        ax.plot(dates, vals, color=color, linewidth=1.4, linestyle=ls,
                label=label, alpha=0.9)

    ax.axhline(0, color=CN_GRAY, linewidth=0.6)
    ax.axhline(1, color=CN_GRAY, linewidth=0.4, linestyle=":", alpha=0.5)

    ax.set_ylabel("Hedge Ratio (β)", fontsize=8, color=CN_GRAY)
    ax.set_title(f"{ticker}  ·  L3 Hedge-Ratio History",
                 fontsize=9, color=CN_NAVY, fontweight="bold", pad=6)

    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right", fontsize=7)
    ax.tick_params(axis="y", labelsize=7)

    ax.legend(fontsize=7, loc="upper left", framealpha=0.8)
    ax.grid(True, axis="y", linestyle="--", linewidth=0.4, alpha=0.5)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    plt.tight_layout(pad=1.2)
    return _fig_to_b64(fig)


def _chart_cumulative_er(history: pd.DataFrame, ticker: str) -> str:
    """Bottom full-width: cumulative ER contribution by factor over the window.

    Each bar shows the arithmetic sum of daily ER fractions over the period,
    giving a sense of which factor drove total explained return over the window.
    """
    fig, ax = plt.subplots(figsize=(11.0, 2.4))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.set_facecolor("white")

    components = [
        ("Market",    "l3_market_er",    CN_NAVY),
        ("Sector",    "l3_sector_er",    CN_TEAL),
        ("Subsector", "l3_subsector_er", CN_SLATE),
        ("Residual\n(Alpha)", "l3_residual_er", CN_GREEN),
    ]

    names, totals, colors = [], [], []
    for label, col, color in components:
        vals = pd.to_numeric(history.get(col, pd.Series(dtype=float)), errors="coerce").fillna(0.0)
        # Sum of daily ER fractions ≈ cumulative attribution
        totals.append(float(vals.sum()) * 100)
        names.append(label)
        colors.append(color)

    x = np.arange(len(names))
    bars = ax.bar(x, totals, color=colors, width=0.55,
                  edgecolor="white", linewidth=0.5)

    for bar, val in zip(bars, totals):
        ypos = val + (0.3 if val >= 0 else -0.3)
        va = "bottom" if val >= 0 else "top"
        ax.text(bar.get_x() + bar.get_width() / 2, ypos,
                f"{val:+.1f}%", ha="center", va=va,
                fontsize=8, color=CN_NAVY, fontweight="bold")

    ax.axhline(0, color=CN_GRAY, linewidth=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=9, color=CN_NAVY)
    ax.set_ylabel("Cumulative ER (%)", fontsize=8, color=CN_GRAY)

    n_days = len(history)
    months = int(round(n_days / 21))
    ax.set_title(
        f"{ticker}  ·  Cumulative L3 ER Attribution  ·  Trailing ~{months} months ({n_days} days)",
        fontsize=9, color=CN_NAVY, fontweight="bold", pad=6,
    )
    ax.grid(True, axis="y", linestyle="--", linewidth=0.4, alpha=0.5)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.tick_params(axis="y", labelsize=7)

    plt.tight_layout(pad=1.0)
    return _fig_to_b64(fig)


def _fig_to_b64(fig: Any) -> str:
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=300, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Render step
# ---------------------------------------------------------------------------

def render_s2_to_pdf(data: S2Data, output_path: str | Path) -> Path:
    """Render the S2 Attribution Waterfall snapshot to a PDF file.

    No API calls. Pure Matplotlib + Jinja2 + WeasyPrint.

    Parameters
    ----------
    data        : S2Data from get_data_for_s2().
    output_path : Destination .pdf path.
    """
    try:
        from jinja2 import Template
        from weasyprint import HTML
    except ImportError as e:
        raise ImportError(
            "PDF rendering requires weasyprint and jinja2. "
            "Install with: pip install riskmodels-py[pdf]"
        ) from e

    m = data.metrics
    hist = data.history

    # ── Build charts ────────────────────────────────────────────────
    chart_er_area = _chart_er_stacked_area(hist, data.ticker)
    chart_hr_ts   = _chart_hr_time_series(hist, data.ticker)
    chart_cumul   = _chart_cumulative_er(hist, data.ticker)

    # ── Helpers ──────────────────────────────────────────────────────
    def _pct(v: Any) -> str:
        try: return f"{float(v) * 100:+.2f}%" if v is not None else "—"
        except Exception: return "—"

    def _fp(v: Any, fmt: str = ".3f") -> str:
        try: return format(float(v), fmt) if v is not None else "—"
        except Exception: return "—"

    subsector = data.meta.get("subsector_etf") or data.meta.get("sector_etf") or "—"
    sector    = data.meta.get("sector_etf") or "—"

    # ── Metric chips ─────────────────────────────────────────────────
    # Latest snapshot values in the chip bar
    chips = [
        {"lbl": "L3 Mkt β (latest)",     "val": _fp(m.get("l3_market_hr"))},
        {"lbl": "L3 Sec β (latest)",      "val": _fp(m.get("l3_sector_hr"))},
        {"lbl": "L3 Sub β (latest)",      "val": _fp(m.get("l3_subsector_hr"))},
        {"lbl": "L3 Res ER (α, latest)",  "val": _pct(m.get("l3_residual_er"))},
        {"lbl": "L3 Mkt ER (latest)",     "val": _pct(m.get("l3_market_er"))},
        {"lbl": "Vol 23d",                "val": _fp(m.get("vol_23d"), ".4f")},
        {"lbl": "Sector ETF",             "val": sector},
        {"lbl": "Subsector ETF",          "val": subsector},
    ]

    # Cumulative residual chip — the "alpha waterfall" headline stat
    peer_chip = None
    if not hist.empty and "l3_residual_er" in hist.columns:
        res_vals = pd.to_numeric(hist["l3_residual_er"], errors="coerce").fillna(0.0)
        cumul_res = float(res_vals.sum()) * 100
        peer_chip = {
            "val": f"{cumul_res:+.1f}%",
            "lbl": f"Cumulative α  ({data.date_start[:7]} → {data.teo[:7]})",
        }

    # ── Subtitle ─────────────────────────────────────────────────────
    subtitle = (
        f"{data.company_name}  ·  {subsector}  ·  "
        f"{data.date_start[:10]} → {data.teo[:10]}"
    )

    # ── Body HTML ────────────────────────────────────────────────────
    quadrant_html = f"""
<div class="quadrant-grid">
  <div class="quadrant-row">
    <div class="quadrant">
      <div class="quadrant-title">L3 ER Attribution — Stacked History</div>
      <img src="data:image/png;base64,{chart_er_area}" alt="ER Stacked Area">
    </div>
    <div class="quadrant">
      <div class="quadrant-title">L3 Hedge-Ratio Drift  ·  Mkt / Sec / Sub β</div>
      <img src="data:image/png;base64,{chart_hr_ts}" alt="HR Time Series">
    </div>
  </div>
  <div class="quadrant full-width">
    <div class="quadrant-title">Cumulative L3 ER by Factor  ·  Trailing {int(round(data.years * 12))} months</div>
    <img src="data:image/png;base64,{chart_cumul}" alt="Cumulative ER Bars">
  </div>
</div>
"""

    # ── Render ───────────────────────────────────────────────────────
    html_str = Template(BASE_HTML).render(
        ticker=data.ticker,
        report_title="S2  ·  Attribution Waterfall",
        subtitle=subtitle,
        data_date=data.teo,
        gen_date=datetime.date.today().isoformat(),
        universe=data.universe,
        confidential=True,
        chips=chips,
        peer_chip=peer_chip,
        body_html=quadrant_html,
        sdk_version=data.sdk_version,
    )

    out = Path(output_path)
    HTML(string=html_str).write_pdf(str(out))
    return out
