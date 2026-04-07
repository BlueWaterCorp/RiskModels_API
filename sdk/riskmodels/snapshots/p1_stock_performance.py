"""P1 Snapshot — Stock Return & Relative Performance (Current × Stock).

The first page of the Performance suite: how has this stock performed,
and how does it compare to its sector, subsector, and the market?

Layout (Letter Landscape, Pillow compositor)
--------------------------------------------
  Left panel : Company identity, performance stats, trailing returns table
  Top-right  : I. Cumulative Returns (stock vs SPY vs sector vs subsector)
  Mid-right  : II. Trailing Returns (grouped bar: stock vs benchmarks)
  Bot-right  : III. Drawdown (underwater equity curve, stock vs SPY)
  Footer     : Confidential + data TEO + SDK version

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots.p1_stock_performance import get_data_for_p1, render_p1_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_p1("NVDA", client)
    data.to_json("nvda_p1.json")
    render_p1_to_pdf(data, "NVDA_P1_Perf.pdf")

    # Or offline:
    data = P1Data.from_json("nvda_p1.json")
    render_p1_to_pdf(data, "NVDA_P1_Perf.pdf")
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go

from ._plotly_theme import PLOTLY_THEME, apply_theme
from ._compose import (
    SnapshotComposer, NAVY, TEAL, TEXT_DARK, TEXT_MID, TEXT_LIGHT,
    WHITE, LIGHT_BG, BORDER,
)
from ._data import (
    fetch_stock_context,
    trailing_returns,
    cumulative_returns,
    rolling_sharpe,
    max_drawdown_series,
    relative_returns,
)

T = PLOTLY_THEME

GREEN_RGB  = (0, 170, 0)
ORANGE_RGB = (224, 112, 0)
RED_RGB    = (200, 40, 40)

WINDOWS = {"1d": 1, "5d": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252}
WINDOW_LABELS = ["1d", "5d", "1m", "3m", "6m", "1y"]


# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class P1Data:
    """All data needed to render the P1 Stock Performance snapshot.

    Produced by get_data_for_p1(). Consumed by render_p1_to_pdf().
    No API calls happen after this object is created.
    """

    ticker: str
    company_name: str
    teo: str
    universe: str
    sector_etf: str | None
    subsector_etf: str | None

    metrics: dict[str, Any]

    # Cumulative return series — lists of (date_str, cumulative_return)
    cum_stock: list[tuple[str, float]]
    cum_spy: list[tuple[str, float]]
    cum_sector: list[tuple[str, float]]
    cum_subsector: list[tuple[str, float]]

    # Trailing returns for each window — {window_label: value}
    tr_stock: dict[str, float | None]
    tr_spy: dict[str, float | None]
    tr_sector: dict[str, float | None]
    tr_subsector: dict[str, float | None]

    # Drawdown series — lists of (date_str, drawdown_value)
    dd_stock: list[tuple[str, float]]
    dd_spy: list[tuple[str, float]]

    # Point-in-time stats
    sharpe_1y: float | None
    max_drawdown: float | None   # worst peak-to-trough (negative decimal)
    vol_23d: float | None

    sdk_version: str = "0.3.0"

    @property
    def subsector_label(self) -> str:
        return self.subsector_etf or self.sector_etf or "—"

    # ── JSON serialization ───────────────────────────────────────────

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "P1Data":
        from ._json_io import load_json
        raw = load_json(path)
        d = raw["data"]

        def _load_series(lst: list | None) -> list[tuple[str, float]]:
            if not lst:
                return []
            return [(str(r[0]), float(r[1])) for r in lst if r[1] is not None]

        return cls(
            ticker=d["ticker"],
            company_name=d["company_name"],
            teo=d["teo"],
            universe=d["universe"],
            sector_etf=d.get("sector_etf"),
            subsector_etf=d.get("subsector_etf"),
            metrics=d.get("metrics", {}),
            cum_stock=_load_series(d.get("cum_stock")),
            cum_spy=_load_series(d.get("cum_spy")),
            cum_sector=_load_series(d.get("cum_sector")),
            cum_subsector=_load_series(d.get("cum_subsector")),
            tr_stock=d.get("tr_stock", {}),
            tr_spy=d.get("tr_spy", {}),
            tr_sector=d.get("tr_sector", {}),
            tr_subsector=d.get("tr_subsector", {}),
            dd_stock=_load_series(d.get("dd_stock")),
            dd_spy=_load_series(d.get("dd_spy")),
            sharpe_1y=d.get("sharpe_1y"),
            max_drawdown=d.get("max_drawdown"),
            vol_23d=d.get("vol_23d"),
            sdk_version=d.get("sdk_version", "0.3.0"),
        )


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------

def _series_to_list(dates: pd.Index | pd.Series, values: pd.Series) -> list[tuple[str, float]]:
    """Convert aligned date + value series to a serializable list."""
    out = []
    for d, v in zip(dates, values):
        if pd.isna(v):
            continue
        out.append((str(d)[:10], float(v)))
    return out


def get_data_for_p1(ticker: str, client: Any, *, years: int = 2) -> "P1Data":
    """Fetch everything needed for the P1 Stock Performance snapshot."""
    import warnings

    ctx = fetch_stock_context(ticker, client, years=years, include_spy=True)

    m = ctx.metrics
    vol_23d = m.get("vol_23d")

    # Trim all series to last 252 trading days for 1Y charts
    def _tail(df: pd.DataFrame | None, days: int = 252) -> pd.DataFrame | None:
        if df is None or df.empty:
            return df
        return df.iloc[-days:].reset_index(drop=True)

    hist    = _tail(ctx.history)
    spy_df  = _tail(ctx.spy_returns)
    sec_df  = _tail(ctx.sector_returns)
    sub_df  = _tail(ctx.subsector_returns)

    # ── Cumulative returns ──────────────────────────────────────────
    def _cum(df: pd.DataFrame | None) -> list[tuple[str, float]]:
        if df is None or df.empty:
            return []
        cr = cumulative_returns(df)
        dates = df["date"] if "date" in df.columns else df.index
        return _series_to_list(dates, cr)

    cum_stock     = _cum(hist)
    cum_spy       = _cum(spy_df)
    cum_sector    = _cum(sec_df)
    cum_subsector = _cum(sub_df)

    # ── Trailing returns (use full 2Y history for window coverage) ──
    tr_stock     = trailing_returns(ctx.history, WINDOWS)
    tr_spy       = trailing_returns(ctx.spy_returns, WINDOWS)
    tr_sector    = trailing_returns(ctx.sector_returns, WINDOWS)
    tr_subsector = trailing_returns(ctx.subsector_returns, WINDOWS)

    # ── Drawdown ────────────────────────────────────────────────────
    def _dd(df: pd.DataFrame | None) -> list[tuple[str, float]]:
        if df is None or df.empty:
            return []
        dd = max_drawdown_series(df)
        dates = df["date"] if "date" in df.columns else df.index
        return _series_to_list(dates, dd)

    dd_stock = _dd(hist)
    dd_spy   = _dd(spy_df)

    # ── Sharpe (63-day rolling, latest value) ───────────────────────
    sharpe_1y: float | None = None
    if hist is not None and not hist.empty:
        sh = rolling_sharpe(hist, window=min(63, len(hist)))
        if not sh.empty and not pd.isna(sh.iloc[-1]):
            sharpe_1y = float(sh.iloc[-1])

    # ── Max drawdown over the 1Y window ────────────────────────────
    max_dd: float | None = None
    if dd_stock:
        max_dd = min(v for _, v in dd_stock)

    return P1Data(
        ticker=ctx.ticker,
        company_name=ctx.company_name,
        teo=ctx.teo,
        universe=ctx.universe,
        sector_etf=ctx.sector_etf,
        subsector_etf=ctx.subsector_etf,
        metrics=m,
        cum_stock=cum_stock,
        cum_spy=cum_spy,
        cum_sector=cum_sector,
        cum_subsector=cum_subsector,
        tr_stock=tr_stock,
        tr_spy=tr_spy,
        tr_sector=tr_sector,
        tr_subsector=tr_subsector,
        dd_stock=dd_stock,
        dd_spy=dd_spy,
        sharpe_1y=sharpe_1y,
        max_drawdown=max_dd,
        vol_23d=float(vol_23d) if vol_23d is not None else None,
        sdk_version=ctx.sdk_version,
    )


# ---------------------------------------------------------------------------
# Chart builders — each returns a standalone go.Figure
# ---------------------------------------------------------------------------

def _make_cum_chart(data: P1Data) -> go.Figure:
    """I. Cumulative Returns — multi-line: stock vs SPY vs sector vs subsector."""
    pal = T.palette

    def _trace(series: list[tuple[str, float]], name: str, color: str,
                width: float = 2, dash: str = "solid") -> go.Scatter | None:
        if not series:
            return None
        dates = [r[0] for r in series]
        vals  = [r[1] * 100 for r in series]  # as %
        return go.Scatter(
            x=dates, y=vals, name=name, mode="lines",
            line=dict(color=color, width=width, dash=dash),
        )

    fig = go.Figure()
    traces = [
        _trace(data.cum_stock,     data.ticker,                   pal.navy,  width=3),
        _trace(data.cum_spy,       "SPY",                          "#888888", width=1.5, dash="dot"),
        _trace(data.cum_sector,    data.sector_etf or "Sector",    pal.teal,  width=1.5, dash="dash"),
        _trace(data.cum_subsector, data.subsector_etf or "Sub",   pal.slate, width=1.5, dash="dashdot"),
    ]
    for t in traces:
        if t is not None:
            fig.add_trace(t)

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Cumulative Return (%)",
            zeroline=True, zerolinecolor="#cccccc", zerolinewidth=1,
            ticksuffix="%",
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.2,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
        ),
        hovermode="x unified",
    )
    return fig


def _make_trailing_bar(data: P1Data) -> go.Figure:
    """II. Trailing Returns grouped bar — stock vs SPY vs sector vs subsector."""
    pal = T.palette

    def _vals(tr: dict[str, float | None]) -> list[float]:
        return [((tr.get(w) or 0) * 100) for w in WINDOW_LABELS]

    labels = WINDOW_LABELS

    stock_vals    = _vals(data.tr_stock)
    spy_vals      = _vals(data.tr_spy)
    sector_vals   = _vals(data.tr_sector)
    sub_vals      = _vals(data.tr_subsector)

    fig = go.Figure()
    for name, vals, color in [
        (data.ticker,                         stock_vals,  pal.navy),
        ("SPY",                                spy_vals,    "#888888"),
        (data.sector_etf or "Sector",          sector_vals, pal.teal),
        (data.subsector_etf or "Subsector",    sub_vals,    pal.slate),
    ]:
        if any(v != 0 for v in vals):
            fig.add_trace(go.Bar(
                x=labels, y=vals, name=name,
                marker=dict(color=color, line=dict(width=0), cornerradius=3),
                text=[f"{v:+.1f}%" for v in vals],
                textposition="outside",
                textfont=dict(family=T.fonts.family, size=10, color=pal.text_dark),
                cliponaxis=False,
            ))

    T.style(fig)
    fig.update_layout(
        barmode="group",
        bargap=0.25, bargroupgap=0.06,
        yaxis=dict(
            title="Return (%)",
            zeroline=True, zerolinecolor="#cccccc", zerolinewidth=1,
            ticksuffix="%",
        ),
        xaxis=dict(title=None),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.25,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
        ),
    )
    return fig


def _make_drawdown_chart(data: P1Data) -> go.Figure:
    """III. Drawdown — underwater equity curve, stock vs SPY."""
    pal = T.palette

    fig = go.Figure()

    if data.dd_stock:
        dates = [r[0] for r in data.dd_stock]
        vals  = [r[1] * 100 for r in data.dd_stock]
        fig.add_trace(go.Scatter(
            x=dates, y=vals, name=data.ticker, mode="lines",
            line=dict(color=pal.navy, width=2),
            fill="tozeroy",
            fillcolor=f"rgba(0,42,94,0.12)",
        ))

    if data.dd_spy:
        dates = [r[0] for r in data.dd_spy]
        vals  = [r[1] * 100 for r in data.dd_spy]
        fig.add_trace(go.Scatter(
            x=dates, y=vals, name="SPY", mode="lines",
            line=dict(color="#888888", width=1.5, dash="dot"),
        ))

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Drawdown (%)",
            zeroline=True, zerolinecolor="#cccccc", zerolinewidth=1,
            ticksuffix="%",
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.25,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
        ),
    )
    return fig


# ---------------------------------------------------------------------------
# Left panel helpers
# ---------------------------------------------------------------------------

def _fmt_market_cap(v: Any) -> str:
    if v is None:
        return "—"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "—"
    if v >= 1e12:
        return f"${v/1e12:.1f}T"
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M"
    return f"${v:,.0f}"


def _fmt_pct(v: float | None, decimals: int = 1) -> str:
    if v is None:
        return "—"
    return f"{v*100:+.{decimals}f}%"


def _fmt_num(v: float | None, decimals: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:.{decimals}f}"


# ---------------------------------------------------------------------------
# Page compositor
# ---------------------------------------------------------------------------

def _compose_p1_page(data: P1Data) -> SnapshotComposer:
    """Compose the P1 snapshot using Pillow layout + Plotly charts."""
    apply_theme()

    m    = data.metrics
    pal  = T.palette

    W, H    = 3300, 2550
    MARGIN  = 150
    PANEL_W = 800
    PANEL_GAP = 50
    CONTENT_X = MARGIN + PANEL_W + PANEL_GAP
    CONTENT_W = W - CONTENT_X - MARGIN

    page = SnapshotComposer(W, H)
    y    = 80

    # ════════════════════════════════════════════════════════════════
    # HEADER (full width)
    # ════════════════════════════════════════════════════════════════
    page.text(MARGIN, y, f"{data.ticker} — {data.company_name}",
              font_size=72, bold=True, color=NAVY)
    page.text_right(W - MARGIN, y + 12, "P1 · Stock Performance",
                    font_size=42, color=TEXT_MID)
    y += 90

    page.text(MARGIN, y,
              f"Ticker: {data.ticker}  ·  Benchmark: {data.subsector_label}  ·  As of: {data.teo}",
              font_size=32, color=TEXT_MID)
    y += 55

    page.hline(y, x0=MARGIN, x1=W - MARGIN, color=NAVY, thickness=6)
    y += 20

    after_header_y = y

    # ════════════════════════════════════════════════════════════════
    # LEFT PANEL background + vertical divider
    # ════════════════════════════════════════════════════════════════
    panel_right = MARGIN + PANEL_W
    page.rect(MARGIN - 10, after_header_y, PANEL_W + 10, H - 90 - after_header_y,
              fill=(248, 249, 251))
    div_x = CONTENT_X - PANEL_GAP // 2
    page.draw.rectangle([div_x, after_header_y, div_x + 1, H - 90], fill=BORDER)

    # ── Left panel contents ──────────────────────────────────────────
    py     = after_header_y + 20
    ROW_H  = 50
    LBL_SZ = 28
    VAL_SZ = 28
    SEC_SZ = 22

    def _panel_row(label: str, val_str: str, val_color=TEXT_DARK):
        nonlocal py
        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)
        py += ROW_H

    def _section(title: str):
        nonlocal py
        page.text(MARGIN, py, title, font_size=SEC_SZ, bold=True, color=TEXT_LIGHT)
        py += int(SEC_SZ * 1.4)
        page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
        py += 10

    # Company name + ticker/date
    page.text(MARGIN, py, data.company_name,
              font_size=42, bold=True, color=NAVY, max_width=PANEL_W)
    py += int(42 * 1.4)
    page.text(MARGIN, py, f"{data.ticker}  ·  {data.teo}",
              font_size=LBL_SZ, color=TEXT_MID)
    py += int(LBL_SZ * 1.4) + 16

    # IDENTITY
    _section("IDENTITY")
    mkt_cap_str = _fmt_market_cap(m.get("market_cap"))
    _panel_row("Market Cap",     mkt_cap_str)
    _panel_row("Sector ETF",     data.sector_etf or "—")
    _panel_row("Subsector ETF",  data.subsector_etf or "—")
    py += 16

    # PERFORMANCE STATS
    _section("PERFORMANCE STATS")
    tr = data.tr_stock
    vol_str    = _fmt_pct(data.vol_23d / (252**0.5) if data.vol_23d else None)  # daily vol — actually show annualised
    vol_str    = f"{data.vol_23d*100:.1f}%" if data.vol_23d else "—"
    sharpe_str = _fmt_num(data.sharpe_1y)
    max_dd_str = _fmt_pct(data.max_drawdown)

    price = m.get("close_price")
    price_str = f"${float(price):.2f}" if price else "—"

    _panel_row("Last Price",     price_str)
    _panel_row("Vol (23d ann.)", vol_str)
    _panel_row("Sharpe (63d)",   sharpe_str,
               val_color=GREEN_RGB if (data.sharpe_1y or 0) > 0.5 else ORANGE_RGB if (data.sharpe_1y or 0) < 0 else TEXT_DARK)
    _panel_row("Max Drawdown",   max_dd_str,
               val_color=ORANGE_RGB if (data.max_drawdown or 0) < -0.15 else TEXT_DARK)
    py += 16

    # TRAILING RETURNS (stock vs SPY)
    _section("TRAILING RETURNS")
    # Header row
    page.text(MARGIN, py, "Period", font_size=SEC_SZ, color=TEXT_LIGHT)
    page.text(MARGIN + int(PANEL_W * 0.38), py, data.ticker, font_size=SEC_SZ, bold=True, color=NAVY)
    page.text(MARGIN + int(PANEL_W * 0.57), py, "SPY", font_size=SEC_SZ, color=TEXT_MID)
    page.text_right(panel_right, py, "vs SPY", font_size=SEC_SZ, color=TEXT_LIGHT)
    py += int(SEC_SZ * 1.5) + 4
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 8

    tr_row_h = 44
    for wl in WINDOW_LABELS:
        sv = data.tr_stock.get(wl)
        bv = data.tr_spy.get(wl)
        spread = (sv - bv) if (sv is not None and bv is not None) else None

        sv_col = GREEN_RGB if (sv or 0) > 0 else ORANGE_RGB
        sp_col = GREEN_RGB if (spread or 0) > 0 else ORANGE_RGB

        page.text(MARGIN, py, wl.upper(), font_size=LBL_SZ, bold=True, color=TEXT_DARK)
        page.text(MARGIN + int(PANEL_W * 0.38), py, _fmt_pct(sv),
                  font_size=LBL_SZ, color=sv_col)
        page.text(MARGIN + int(PANEL_W * 0.57), py, _fmt_pct(bv),
                  font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, _fmt_pct(spread),
                        font_size=LBL_SZ, bold=True, color=sp_col)
        py += tr_row_h

    # ════════════════════════════════════════════════════════════════
    # RIGHT CONTENT AREA
    # ════════════════════════════════════════════════════════════════
    y = after_header_y

    FOOTER_Y  = H - 90
    half_w    = CONTENT_W // 2 - 20
    GAP       = 36   # gap between chart rows

    # Fixed heights for headers/insights, then split remaining between charts
    # Section I:    title(56) + insight(40) = 96
    # Divider:      1 + 20 = 21
    # Section II+III: title(56) + insight(40) = 96
    OVERHEAD = 96 + 21 + 96
    chart_area = FOOTER_Y - y - OVERHEAD - GAP
    chart_h_top = int(chart_area * 0.50)           # I. cumulative returns
    chart_h_bot = chart_area - chart_h_top          # II + III (same height, side by side)

    # ── Section I: Cumulative Returns ───────────────────────────────
    page.text(CONTENT_X, y, "I. Cumulative Returns",
              font_size=38, bold=True, color=NAVY)
    y += 56
    page.text(CONTENT_X, y,
              f"{data.ticker} vs SPY, {data.sector_etf or 'Sector'}, "
              f"{data.subsector_etf or 'Subsector'} · past 252 trading days ending {data.teo}.",
              font_size=26, italic=True, color=TEAL, max_width=CONTENT_W)
    y += 40

    cum_fig = _make_cum_chart(data)
    page.paste_figure(cum_fig, CONTENT_X, y, CONTENT_W, chart_h_top)
    y += chart_h_top + GAP

    # ── Section divider ──────────────────────────────────────────────
    page.hline(y, x0=CONTENT_X, x1=W - MARGIN, color=BORDER, thickness=1)
    y += 20

    # ── Sections II + III side by side ──────────────────────────────
    y_row2 = y

    # Section II title + chart (left half)
    page.text(CONTENT_X, y, "II. Trailing Returns",
              font_size=38, bold=True, color=NAVY)
    page.text(CONTENT_X + half_w + 40, y, "III. Drawdown",
              font_size=38, bold=True, color=NAVY)
    y += 56

    tr_periods = ", ".join(WINDOW_LABELS)
    page.text(CONTENT_X, y,
              f"Stock vs benchmarks over {tr_periods} · as of {data.teo}.",
              font_size=26, italic=True, color=TEAL, max_width=half_w - 10)
    page.text(CONTENT_X + half_w + 40, y,
              f"Underwater equity curve vs SPY · past year ending {data.teo}.",
              font_size=26, italic=True, color=TEAL, max_width=half_w - 10)
    y += 40

    tr_fig  = _make_trailing_bar(data)
    dd_fig  = _make_drawdown_chart(data)
    page.paste_figure(tr_fig, CONTENT_X,             y, half_w, chart_h_bot)
    page.paste_figure(dd_fig, CONTENT_X + half_w + 40, y, half_w, chart_h_bot)

    # ════════════════════════════════════════════════════════════════
    # FOOTER
    # ════════════════════════════════════════════════════════════════
    footer_y = H - 80
    page.hline(footer_y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=2)
    footer_y += 12
    page.text(MARGIN, footer_y,
              f"ERM3 V3 · riskmodels-py · {data.teo}",
              font_size=24, color=TEXT_LIGHT)
    page.text_right(W - MARGIN, footer_y,
                    "BW Macro · Confidential · Not Investment Advice",
                    font_size=24, color=TEXT_LIGHT)

    return page


# ---------------------------------------------------------------------------
# Public render API
# ---------------------------------------------------------------------------

def render_p1_to_pdf(data: P1Data, output_path: str | Path) -> Path:
    """Render the P1 Stock Performance snapshot to a PDF file."""
    page = _compose_p1_page(data)
    return page.save(output_path)


def render_p1_to_png(data: P1Data, output_path: str | Path) -> Path:
    """Render the P1 Stock Performance snapshot to a PNG file."""
    page = _compose_p1_page(data)
    return page.save(output_path)


def render_p1_to_png_bytes(data: P1Data) -> bytes:
    """Render the P1 snapshot to PNG bytes in memory."""
    page = _compose_p1_page(data)
    return page.to_png_bytes()
