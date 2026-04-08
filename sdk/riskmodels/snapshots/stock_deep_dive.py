"""Stock Deep Dive — unified 1-page landscape snapshot (Risk + Performance).

Combines the best of R1 (risk decomposition) and P1 (return & relative perf)
into a single "Deep Dive" page.  Key innovation: the **Residual Alpha Drawdown**
chart isolates idiosyncratic failure from factor moves, while the σ-scaled
Risk DNA Fingerprint shows the target + top 6 subsector peers (7 bars, like
the MAG7 chart from BWMACRO/article_visuals.py but for any stock's peer group).

Layout (Letter Landscape, Pillow compositor)
--------------------------------------------
  Left panel (25%) : Identity, Performance Stats, Rankings (labeled subsector ranks),
                      Risk Decomposition ER, Macro Correlations, ERM3 methodology (L1–L3)
  Right area  (75%):
      AI Summary Box
      I.  Cumulative Returns — stock vs SPY vs sector vs subsector + L3 Residual Return
      II. Residual Alpha Drawdown (bottom-left)
      III. Equity Factor Decomposition (bottom-right, σ-scaled Matplotlib bar, 7 rows)
  Footer: ERM3 attribution

Data pipeline
-------------
    get_data_for_dd()  — calls get_data_for_p1() + PeerGroupProxy.from_ticker()
    render_dd_to_pdf() — pure render, no network calls

Usage
-----
    from riskmodels.snapshots.stock_deep_dive import get_data_for_dd, render_dd_to_pdf

    data = get_data_for_dd("NVDA", client)
    render_dd_to_pdf(data, "NVDA_DD.pdf")
"""

from __future__ import annotations

import io
import math as _math
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go

from ..peer_group import PeerComparison, PeerGroupProxy
from ._plotly_theme import PLOTLY_THEME, apply_theme
from ._compose import (
    SnapshotComposer, NAVY, TEAL, TEXT_DARK, TEXT_MID, TEXT_LIGHT,
    WHITE, LIGHT_BG, BORDER,
)
from ._data import series_with_zero_start
from ..visuals.smart_subheader import generate_subheader
from .p1_stock_performance import (
    P1Data,
    get_data_for_p1,
    _generate_p1_insights,
    _make_cum_chart,
    _fmt_market_cap,
    _fmt_pct,
    _fmt_num,
    _pct_ordinal,
    _sharpe_qualifier,
    WINDOW_LABELS,
)


# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class DDData:
    """All data needed for the Stock Deep Dive — P1Data + peer comparison."""

    p1: P1Data
    peer_comparison: PeerComparison | None = None

    # Delegate common fields
    @property
    def ticker(self) -> str: return self.p1.ticker
    @property
    def company_name(self) -> str: return self.p1.company_name
    @property
    def teo(self) -> str: return self.p1.teo
    @property
    def metrics(self) -> dict: return self.p1.metrics
    @property
    def subsector_label(self) -> str: return self.p1.subsector_label
    @property
    def subsector_etf(self): return self.p1.subsector_etf
    @property
    def sector_etf(self): return self.p1.sector_etf

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "DDData":
        from ._json_io import load_json
        import json as _json, tempfile as _tmp
        raw = load_json(path)
        d = raw["data"]

        # Reconstruct P1Data — write nested p1 dict to temp file for P1Data.from_json
        if "p1" in d:
            p1_payload = {"schema_version": "1.0", "snapshot_type": "P1Data",
                          "generated_utc": raw.get("generated_utc", ""), "data": d["p1"]}
            with _tmp.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
                _json.dump(p1_payload, tf)
                tf_path = tf.name
            p1 = P1Data.from_json(tf_path)
            import os; os.unlink(tf_path)
        else:
            p1 = P1Data.from_json(path)

        pc = None
        pc_raw = d.get("peer_comparison")
        if pc_raw is not None:
            pc = _rebuild_peer_comparison(pc_raw)

        return cls(p1=p1, peer_comparison=pc)


def _rebuild_peer_comparison(pc_raw: dict) -> PeerComparison:
    """Reconstruct PeerComparison from serialized dict (same as R1)."""
    peer_detail_records = pc_raw.get("peer_detail", [])
    peer_detail_df = pd.DataFrame(peer_detail_records)
    if not peer_detail_df.empty and "ticker" in peer_detail_df.columns:
        peer_detail_df = peer_detail_df.set_index("ticker")

    pp_raw = pc_raw.get("peer_portfolio", {})
    from ..portfolio_math import PortfolioAnalysis
    from ..lineage import RiskLineage
    peer_portfolio = PortfolioAnalysis(
        lineage=RiskLineage(),
        per_ticker=pd.DataFrame(pp_raw.get("per_ticker", [])),
        portfolio_hedge_ratios=pp_raw.get("portfolio_hedge_ratios", {}),
        portfolio_l3_er_weighted_mean=pp_raw.get("portfolio_l3_er_weighted_mean", {}),
        weights=pp_raw.get("weights", {}),
        errors=pp_raw.get("errors", {}),
    )

    return PeerComparison(
        target_ticker=pc_raw["target_ticker"],
        peer_group_label=pc_raw["peer_group_label"],
        target_metrics=pc_raw.get("target_metrics", {}),
        peer_portfolio=peer_portfolio,
        target_l3_residual_er=pc_raw.get("target_l3_residual_er"),
        peer_avg_l3_residual_er=pc_raw.get("peer_avg_l3_residual_er"),
        selection_spread=pc_raw.get("selection_spread"),
        target_vol=pc_raw.get("target_vol"),
        peer_avg_vol=pc_raw.get("peer_avg_vol"),
        peer_detail=peer_detail_df,
    )


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------

def get_data_for_dd(ticker: str, client: Any, *, years: int = 2) -> DDData:
    """Fetch everything needed for the Stock Deep Dive.

    Calls get_data_for_p1() for returns/rankings/macro, then adds
    PeerGroupProxy for the subsector Risk DNA chart.
    """
    p1 = get_data_for_p1(ticker, client, years=years)

    peer_comparison: PeerComparison | None = None
    try:
        proxy = PeerGroupProxy.from_ticker(
            client, ticker,
            group_by="subsector_etf",
            weighting="market_cap",
            sector_etf_override=p1.subsector_etf,
            max_peers=15,
        )
        peer_comparison = proxy.compare(client)
    except Exception as exc:
        warnings.warn(
            f"Could not build PeerGroupProxy for {ticker}: {exc}. "
            "Rendering DD without peer context.",
            UserWarning, stacklevel=2,
        )

    # Last-resort: try loading macro from existing P1 cache if DD fetch got empty
    if not any(v is not None for v in (p1.macro_correlations or {}).values()):
        try:
            from pathlib import Path as _Path
            _p1_cache = _Path(__file__).resolve().parent / "output" / f"{ticker.upper()}_p1_cache.json"
            if _p1_cache.exists():
                import json as _json
                _p1_raw = _json.loads(_p1_cache.read_text())
                _cached_mc = _p1_raw.get("data", {}).get("macro_correlations", {})
                if any(v is not None for v in _cached_mc.values()):
                    p1.macro_correlations = _cached_mc
        except Exception:
            pass

    return DDData(p1=p1, peer_comparison=peer_comparison)

T = PLOTLY_THEME

GREEN_RGB  = (0, 170, 0)
ORANGE_RGB = (224, 112, 0)
RED_RGB    = (200, 40, 40)


# ---------------------------------------------------------------------------
# New computations — residual drawdown + risk DNA
# ---------------------------------------------------------------------------

def _residual_dd_series(
    l3_er: list[tuple[str, float, float, float, float]],
) -> list[tuple[str, float]]:
    """Compute drawdown of cumulative residual alpha.

    Returns list of (date_str, drawdown_decimal).  The drawdown is always ≤ 0:
    0 = at peak, negative = below peak.  This isolates the "alpha bet failure"
    from factor-driven moves.
    """
    if not l3_er:
        return []
    running = 0.0
    peak = 0.0
    dd: list[tuple[str, float]] = []
    for date_str, _mkt, _sec, _sub, res in l3_er:
        running += res
        peak = max(peak, running)
        dd.append((date_str, running - peak))
    return dd


def _risk_dna_segments(m: dict) -> dict[str, float]:
    """σ-scaled risk DNA: segment_i = (|ER_i| / Σ|ER_j|) × vol_23d.

    Returns dict with keys: mkt, sec, sub, res, vol, systematic_pct.
    """
    def _gf(full: str, abbr: str) -> float:
        v = m.get(full) if m.get(full) is not None else m.get(abbr)
        return abs(float(v)) if v is not None else 0.0

    mkt = _gf("l3_market_er",    "l3_mkt_er")
    sec = _gf("l3_sector_er",    "l3_sec_er")
    sub = _gf("l3_subsector_er", "l3_sub_er")
    res = _gf("l3_residual_er",  "l3_res_er")
    total = mkt + sec + sub + res or 1.0

    vol = float(m.get("vol_23d") or m.get("volatility") or 0.35)
    if vol > 1.5:
        vol /= 100.0  # percent → decimal

    return {
        "mkt": (mkt / total) * vol,
        "sec": (sec / total) * vol,
        "sub": (sub / total) * vol,
        "res": (res / total) * vol,
        "vol": vol,
        "systematic_pct": (mkt + sec + sub) / total * 100,
    }


# ---------------------------------------------------------------------------
# Chart builders
# ---------------------------------------------------------------------------

def _make_dd_cum_chart(data: P1Data) -> go.Figure:
    """I. Cumulative Returns — upgraded styling for Deep Dive (richer stock line, emerald L3 residual)."""
    pal = T.palette
    fnt = T.fonts

    STOCK_COLOR  = "#4f46e5"    # indigo-600
    ALPHA_COLOR  = "#10b981"    # emerald-500
    SPY_COLOR    = "#94a3b8"    # slate-400
    SECTOR_COLOR = "#0891b2"    # cyan-600
    SUB_COLOR    = "#7c3aed"    # violet-600

    def _trace(series, name, color, width=1.5, dash="solid"):
        if not series:
            return None
        dates = [r[0] for r in series]
        vals  = [r[1] * 100 for r in series]
        return go.Scatter(
            x=dates, y=vals, name=name, mode="lines",
            line=dict(color=color, width=width, dash=dash),
            hovertemplate=f"<b>{name}</b>: %{{y:.1f}}%<extra></extra>",
        )

    # Build cumulative L3 residual return line (daily residual explained return)
    res_cum_series: list[tuple[str, float]] = []
    if data.l3_er_series:
        running = 0.0
        for r in data.l3_er_series:
            running += r[4]
            res_cum_series.append((r[0], running))

    s_stock = series_with_zero_start(data.cum_stock)
    s_spy = series_with_zero_start(data.cum_spy)
    s_sec = series_with_zero_start(data.cum_sector)
    s_sub = series_with_zero_start(data.cum_subsector)
    s_res = series_with_zero_start(res_cum_series)

    fig = go.Figure()
    for t in [
        _trace(s_stock,       data.ticker,                  STOCK_COLOR,  width=3.5),
        _trace(s_spy,         "SPY",                         SPY_COLOR,    width=1.3, dash="dot"),
        _trace(s_sec,         data.sector_etf or "Sector",   SECTOR_COLOR, width=1.3, dash="dash"),
        _trace(s_sub,         data.subsector_etf or "Sub",  SUB_COLOR,    width=1.3, dash="dashdot"),
        _trace(s_res,         "L3 Residual Return",          ALPHA_COLOR,  width=2.2, dash="solid"),
    ]:
        if t is not None:
            fig.add_trace(t)

    # Annotate period-end values (use anchored series for last point)
    for series, color, prefix in [
        (s_stock,            STOCK_COLOR,  " "),
        (s_spy,              SPY_COLOR,    " "),
        (s_sec,              SECTOR_COLOR, " "),
        (s_sub,              SUB_COLOR,    " "),
        (s_res,              ALPHA_COLOR,  " "),
    ]:
        if series:
            last_date, last_val = series[-1][0], series[-1][1] * 100
            fig.add_annotation(
                x=last_date, y=last_val, xanchor="left", yanchor="middle",
                text=f"{prefix}{last_val:+.1f}%", showarrow=False,
                font=dict(family=fnt.family, size=fnt.annotation, color=color),
            )

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Cumulative Return (%)",
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%", tickfont=dict(size=fnt.axis_tick),
        ),
        xaxis=dict(title=None, showgrid=False),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.22,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
            font=dict(size=fnt.body),
        ),
        hovermode="x unified",
    )
    return fig


def _make_residual_dd_chart(data: P1Data) -> go.Figure:
    """II. Residual Alpha Drawdown — underwater curve of cumulative idiosyncratic return.

    Unlike the stock drawdown in P1, this isolates the residual bet:
    if the stock drops because the market drops, this curve stays flat.
    """
    pal = T.palette
    fnt = T.fonts
    fig = go.Figure()

    res_dd = _residual_dd_series(data.l3_er_series)
    if not res_dd:
        fig.add_annotation(
            text="Residual attribution data unavailable",
            xref="paper", yref="paper", x=0.5, y=0.5, showarrow=False,
            font=dict(size=16, color=pal.text_light),
        )
        T.style(fig)
        return fig

    dates = [r[0] for r in res_dd]
    vals  = [r[1] * 100 for r in res_dd]

    fig.add_trace(go.Scatter(
        x=dates, y=vals, name="Residual α DD", mode="lines",
        line=dict(color="#ef4444", width=2),
        fill="tozeroy",
        fillcolor="rgba(239,68,68,0.12)",
        hovertemplate="<b>Alpha DD</b>: %{y:.1f}%<extra></extra>",
    ))

    # Max residual DD callout
    if vals:
        min_dd = min(vals)
        min_idx = vals.index(min_dd)
        min_date = dates[min_idx]

        fig.add_shape(
            type="line", xref="paper", x0=0, x1=1,
            y0=min_dd, y1=min_dd,
            line=dict(color=pal.orange, width=1, dash="dot"),
        )
        fig.add_annotation(
            xref="paper", x=0.02, y=min_dd,
            text=f"Max α DD: {min_dd:.1f}%",
            showarrow=False, xanchor="left", yanchor="top",
            font=dict(family=fnt.family, size=fnt.annotation, color=pal.orange),
            bgcolor="rgba(255,255,255,0.85)",
            bordercolor=pal.orange, borderwidth=1, borderpad=5,
        )

    T.style(fig)
    fig.update_layout(
        yaxis=dict(
            title="Residual α Drawdown (%)",
            zeroline=True, zerolinecolor="#dddddd", zerolinewidth=1,
            ticksuffix="%",
        ),
        xaxis=dict(title=None, showgrid=False),
        showlegend=False,
    )
    return fig


def _make_alpha_quality_scatter(dd: DDData) -> go.Figure:
    """II. L3 Residual Alpha Quality — peer scatter (return vs vol).

    Y-axis: L3 Residual ER (%) — fraction of explained return from idiosyncratic alpha.
    X-axis: Residual Vol (%) — vol_23d × sqrt(l3_residual_er).
    Dot size: market cap.  Target stock: star marker, electric blue.
    Diagonal Sharpe=1 reference line.  Upper-left quadrant = best.
    """
    import numpy as np

    pal = T.palette
    fnt = T.fonts
    fig = go.Figure()
    pc = dd.peer_comparison
    m = dd.metrics

    def _gf(d: dict, full: str, abbr: str) -> float:
        v = d.get(full) if d.get(full) is not None else d.get(abbr)
        return float(v) if v is not None and not (isinstance(v, float) and _math.isnan(v)) else 0.0

    def _vol(d: dict) -> float:
        for k in ("vol_23d", "volatility"):
            v = d.get(k)
            if v is not None:
                try:
                    vf = float(v)
                    if _math.isfinite(vf) and vf > 0:
                        return vf if vf <= 1.5 else vf / 100.0
                except (TypeError, ValueError):
                    pass
        sv = d.get("stock_var")
        if sv is not None:
            try:
                svf = float(sv)
                if _math.isfinite(svf) and svf > 0:
                    return _math.sqrt(svf * 252)
            except (TypeError, ValueError):
                pass
        return 0.30

    # Target stock
    target_res_er = _gf(m, "l3_residual_er", "l3_res_er")
    target_vol = _vol(m)
    target_res_vol = target_vol * _math.sqrt(max(target_res_er, 0.001))
    target_mkt_cap = float(m.get("market_cap") or 1e9)

    # Peer data
    peer_tickers, peer_x, peer_y, peer_sizes, peer_labels = [], [], [], [], []
    if pc is not None and not pc.peer_detail.empty:
        for t, row in pc.peer_detail.iterrows():
            rd = dict(row)
            res_er = _gf(rd, "l3_residual_er", "l3_res_er")
            vol = _vol(rd)
            res_vol = vol * _math.sqrt(max(res_er, 0.001))
            mkt_cap = float(rd.get("market_cap") or 1e9)
            cn = str(rd.get("company_name", "")) if rd.get("company_name") else ""

            peer_tickers.append(str(t))
            peer_x.append(res_vol * 100)
            peer_y.append(res_er * 100)
            peer_sizes.append(mkt_cap)
            peer_labels.append(str(t))

    # Normalize dot sizes (8–28px range)
    all_caps = peer_sizes + [target_mkt_cap]
    max_cap = max(all_caps) if all_caps else 1e9
    peer_dot_sizes = [8 + (c / max_cap) * 20 for c in peer_sizes]
    target_dot_size = 8 + (target_mkt_cap / max_cap) * 20

    # Quadrant shading: upper-left = best (high return, low vol)
    all_x = peer_x + [target_res_vol * 100]
    all_y = peer_y + [target_res_er * 100]
    x_mid = float(np.median(all_x)) if all_x else 15
    y_mid = float(np.median(all_y)) if all_y else 25

    fig.add_shape(type="rect", x0=0, x1=x_mid, y0=y_mid, y1=100,
                  fillcolor="rgba(16,185,129,0.05)", line_width=0)  # top-left: green tint
    fig.add_shape(type="rect", x0=x_mid, x1=100, y0=0, y1=y_mid,
                  fillcolor="rgba(239,68,68,0.04)", line_width=0)   # bottom-right: red tint

    # Quadrant labels
    _qlbl = dict(showarrow=False, font=dict(size=9, color="#cbd5e1"))
    fig.add_annotation(x=x_mid * 0.25, y=y_mid + (100 - y_mid) * 0.85,
                       text="High α / Low Vol", **_qlbl)
    fig.add_annotation(x=x_mid + (100 - x_mid) * 0.65, y=y_mid * 0.15,
                       text="Low Quality / High Risk", **_qlbl)

    # Sharpe=1 diagonal reference (return = vol)
    diag_max = max(max(all_x, default=30), max(all_y, default=30)) * 1.1
    fig.add_trace(go.Scatter(
        x=[0, diag_max], y=[0, diag_max],
        mode="lines", name="Sharpe = 1.0",
        line=dict(color="#94a3b8", width=1.5, dash="dash"),
        showlegend=False,
    ))
    fig.add_annotation(
        x=diag_max * 0.72, y=diag_max * 0.72,
        text="Fair risk-return", showarrow=False,
        font=dict(size=11, color="#64748b"), textangle=-38,
    )

    # Peer dots — color-coded by market cap (teal gradient: lighter=smaller, darker=larger)
    if peer_x:
        # Label top 3 by market cap
        top3_idx = sorted(range(len(peer_sizes)), key=lambda i: peer_sizes[i], reverse=True)[:3]
        text_labels = ["" for _ in peer_labels]
        for idx in top3_idx:
            text_labels[idx] = f"  {peer_labels[idx]}"

        # Normalize market caps to 0–1 for colorscale
        _min_cap = min(peer_sizes) if peer_sizes else 1
        _max_cap = max(peer_sizes) if peer_sizes else 1
        _cap_range = _max_cap - _min_cap or 1
        peer_cap_norm = [(_c - _min_cap) / _cap_range for _c in peer_sizes]

        fig.add_trace(go.Scatter(
            x=peer_x, y=peer_y,
            mode="markers+text",
            name="Peers",
            marker=dict(
                size=peer_dot_sizes,
                color=peer_cap_norm,
                colorscale=[[0, "#bae6fd"], [0.5, "#0891b2"], [1, "#164e63"]],
                opacity=0.8,
                line=dict(width=0.5, color="#e2e8f0"),
                showscale=True,
                colorbar=dict(
                    title=dict(text="Mkt Cap", font=dict(size=9)),
                    thickness=10, len=0.4, x=1.02, y=0.5,
                    tickvals=[], ticktext=[],
                ),
            ),
            text=text_labels,
            textposition="middle right",
            textfont=dict(size=9, color="#475569"),
            hovertemplate="<b>%{hovertext}</b><br>Res Vol: %{x:.1f}%<br>Res ER: %{y:.1f}%<extra></extra>",
            hovertext=peer_labels,
        ))

    # Target stock — white halo behind, then bold blue circle
    _tx, _ty = target_res_vol * 100, target_res_er * 100
    fig.add_trace(go.Scatter(
        x=[_tx], y=[_ty], mode="markers", name="_halo", showlegend=False,
        marker=dict(size=target_dot_size + 18, color="white", opacity=0.9,
                    line=dict(width=0)),
    ))
    fig.add_trace(go.Scatter(
        x=[_tx], y=[_ty],
        mode="markers+text",
        name=dd.ticker,
        marker=dict(
            size=target_dot_size + 8,
            color="#4f46e5",
            symbol="circle",
            line=dict(width=2.5, color="#312e81"),
        ),
        text=[f"  <b>{dd.ticker}</b>"],
        textposition="middle right",
        textfont=dict(size=14, color="#4f46e5", family=fnt.family),
        hovertemplate=f"<b>{dd.ticker}</b><br>Res Vol: %{{x:.1f}}%<br>Res ER: %{{y:.1f}}%<extra></extra>",
    ))

    T.style(fig)
    x_max = max(all_x, default=30) * 1.15
    y_max = max(all_y, default=50) * 1.15
    fig.update_layout(
        xaxis=dict(
            title="Annualized L3 Residual Vol (%)",
            ticksuffix="%", zeroline=False,
            range=[0, x_max],
        ),
        yaxis=dict(
            title="L3 Residual ER (%)",
            ticksuffix="%", zeroline=False,
            range=[0, y_max],
        ),
        showlegend=False,
    )
    return fig


def _make_peer_dna_chart(dd: DDData) -> "Image.Image":
    """III. Equity Factor Decomposition — target + top 6 peers by market cap (7 bars).

    σ-scaled horizontal stacked bars (BWMACRO/article_visuals.py style).
    Annotations use ax.get_yaxis_transform() so they always clear the plot edge.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from PIL import Image as _PILImage

    WHITE_C    = "#ffffff"
    DEEP_BLUE  = "#002a5e"
    SLATE      = "#64748b"
    LAYER_COLORS = {
        "mkt": "#3b82f6", "sec": "#06b6d4",
        "sub": "#f97316", "res": "#94a3b8",
    }
    pc = dd.peer_comparison
    m  = dd.metrics
    sub_etf = dd.subsector_etf or dd.sector_etf or ""

    def _vol(rd: dict) -> float:
        for key in ("vol_23d", "volatility", "annualized_volatility"):
            v = rd.get(key)
            if v is not None:
                try:
                    vf = float(v)
                    if _math.isfinite(vf) and vf > 0:
                        return vf if vf <= 1.5 else vf / 100.0
                except (TypeError, ValueError):
                    pass
        sv = rd.get("stock_var")
        if sv is not None:
            try:
                svf = float(sv)
                if _math.isfinite(svf) and svf > 0:
                    return _math.sqrt(svf * 252)
            except (TypeError, ValueError):
                pass
        return 0.35

    def _rr(rd: dict) -> tuple[float, float, float, float]:
        def pick(*keys: str) -> float:
            for k in keys:
                if k in rd and rd[k] is not None:
                    try:
                        v = float(rd[k])
                        if _math.isfinite(v): return v
                    except (TypeError, ValueError): pass
            return 0.0
        return (
            pick("l3_market_rr", "l3_market_er", "l3_mkt_er"),
            pick("l3_sector_rr", "l3_sector_er", "l3_sec_er"),
            pick("l3_subsector_rr", "l3_subsector_er", "l3_sub_er"),
            pick("l3_residual_er", "l3_res_er"),
        )

    def _g(full: str, abbr: str):
        return m.get(full) if m.get(full) is not None else m.get(abbr)

    # Build rows: target + top 6 peers by market_cap
    target_row: dict = {
        "ticker": dd.ticker,
        "l3_market_er": _g("l3_market_er", "l3_mkt_er") or 0.0,
        "l3_sector_er": _g("l3_sector_er", "l3_sec_er") or 0.0,
        "l3_subsector_er": _g("l3_subsector_er", "l3_sub_er") or 0.0,
        "l3_residual_er": _g("l3_residual_er", "l3_res_er") or 0.0,
        "vol_23d": _g("vol_23d", "volatility"),
        "subsector_etf": sub_etf,
    }
    target_row["vol_23d"] = _vol(target_row)

    rows = [target_row]
    if pc is not None and not pc.peer_detail.empty:
        sort_col = "market_cap" if "market_cap" in pc.peer_detail.columns else "weight"
        top_peers = pc.peer_detail.sort_values(sort_col, ascending=False, na_position="last").head(6)
        for t, row in top_peers.iterrows():
            rd = {k: (None if (isinstance(v, float) and _math.isnan(v)) else v)
                  for k, v in dict(row).items()}
            rd["ticker"] = str(t)
            rd.setdefault("subsector_etf", sub_etf)
            rd["vol_23d"] = _vol(rd)
            rows.append(rd)

    n = len(rows)
    tickers = [r["ticker"] for r in rows]
    y_pos = np.arange(n)

    sigma = np.array([_vol(r) for r in rows])
    mkt_a = np.array([_rr(r)[0] for r in rows])
    sec_a = np.array([_rr(r)[1] for r in rows])
    sub_a = np.array([_rr(r)[2] for r in rows])
    res_a = np.array([_rr(r)[3] for r in rows])

    mkt_v = mkt_a * sigma
    sec_v = sec_a * sigma
    sub_v = sub_a * sigma
    res_v = res_a * sigma
    totals = mkt_v + sec_v + sub_v + res_v
    xmax = float(np.nanmax(totals)) * 1.07 if n else 0.6
    xmax = max(xmax, 0.05)

    fig_h = max(3.0, n * 0.52 + 1.6)
    fig, ax = plt.subplots(figsize=(8.5, fig_h))
    fig.patch.set_facecolor(WHITE_C)
    ax.set_facecolor("#fafbfc")

    h_bar = 0.60
    ax.barh(y_pos, mkt_v, color=LAYER_COLORS["mkt"], label="L3 market RR",
            height=h_bar, edgecolor=WHITE_C, linewidth=0.5)
    left = mkt_v.copy()
    ax.barh(y_pos, sec_v, left=left, color=LAYER_COLORS["sec"], label="L3 sector RR",
            height=h_bar, edgecolor=WHITE_C, linewidth=0.5)
    left += sec_v
    ax.barh(y_pos, sub_v, left=left, color=LAYER_COLORS["sub"], label="L3 subsector RR",
            height=h_bar, edgecolor=WHITE_C, linewidth=0.5)
    left += sub_v
    ax.barh(y_pos, res_v, left=left, color=LAYER_COLORS["res"], label="HR",
            height=h_bar, edgecolor=WHITE_C, linewidth=0.5)

    # Highlight target row (row 0) with navy outline
    total_0 = float(mkt_v[0] + sec_v[0] + sub_v[0] + res_v[0])
    from matplotlib.patches import FancyBboxPatch
    _outline = FancyBboxPatch(
        (0, -h_bar / 2), total_0, h_bar,
        boxstyle="round,pad=0", linewidth=2.0,
        edgecolor=DEEP_BLUE, facecolor="none", zorder=10,
        clip_on=False,
    )
    ax.add_patch(_outline)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(tickers, fontsize=9.5, fontweight="bold", color=DEEP_BLUE)
    # Small negative x0 so the target-row outline stroke is not clipped on the left
    _xpad = max(xmax * 0.004, 0.001)
    ax.set_xlim(-_xpad, xmax)
    ax.set_xticks(np.linspace(0, xmax, min(6, max(3, int(xmax / 0.05) + 1))))
    ax.set_ylim(-0.5, n - 0.5)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x:.0%}"))
    ax.set_xlabel(
        "Annualized σ; segments = σ × (L3 market/sector/subsector RR + HR residual)",
        fontsize=8.5, color=SLATE,
    )
    ax.invert_yaxis()
    ax.grid(axis="x", color="#e2e8f0", linewidth=0.8, linestyle="--", alpha=0.8)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_visible(False)

    ax.legend(
        loc="upper center", bbox_to_anchor=(0.38, -0.16), ncol=4,
        frameon=True, fancybox=True, fontsize=7.5, columnspacing=1.5,
        handlelength=1.1, handletextpad=0.5,
        edgecolor="#e2e8f0", facecolor="#fafafa",
    )
    plt.tight_layout(rect=[0, 0.10, 0.995, 1.0])

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=250, bbox_inches="tight",
                facecolor=WHITE_C, edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return _PILImage.open(buf).convert("RGB")


# ---------------------------------------------------------------------------
# AI Insights — builds on P1Insights with residual drawdown context
# ---------------------------------------------------------------------------

def _generate_dd_insights(data: DDData) -> dict[str, str]:
    """Generate insights for all Deep Dive panels."""
    p1i = _generate_p1_insights(data.p1)
    teo = data.teo
    ticker = data.ticker
    sub = data.subsector_label

    # Alpha quality insight (Panel II scatter)
    m = data.metrics
    def _gfi(full: str, abbr: str) -> float:
        v = m.get(full) if m.get(full) is not None else m.get(abbr)
        return float(v) if v is not None else 0.0
    target_res_er = _gfi("l3_residual_er", "l3_res_er")
    target_vol = float(m.get("vol_23d") or m.get("volatility") or 0.35)
    if target_vol > 1.5:
        target_vol /= 100.0
    target_res_vol = target_vol * _math.sqrt(max(target_res_er, 0.001))

    # Rank among peers on risk-adjusted L3 residual (residual ER / residual vol)
    pc = data.peer_comparison
    target_ra = (target_res_er / target_res_vol) if target_res_vol > 0.001 else 0.0
    n_peers_above = 0
    n_total = 1
    if pc is not None and not pc.peer_detail.empty:
        for _, row in pc.peer_detail.iterrows():
            p_res = row.get("l3_residual_er") or row.get("l3_res_er") or 0
            p_vol_raw = row.get("vol_23d") or row.get("volatility")
            try:
                p_res_f = float(p_res)
                p_vol_f = float(p_vol_raw) if p_vol_raw is not None else 0.30
                if p_vol_f > 1.5:
                    p_vol_f /= 100.0
                p_res_vol = p_vol_f * _math.sqrt(max(p_res_f, 0.001))
                p_ra = p_res_f / p_res_vol if p_res_vol > 0.001 else 0.0
            except (TypeError, ValueError):
                continue
            n_total += 1
            if p_ra > target_ra:
                n_peers_above += 1
    rank_pct = int((1 - n_peers_above / n_total) * 100) if n_total > 1 else 50
    rank_ordinal = _pct_ordinal(rank_pct)
    rank_label = "top-decile" if rank_pct >= 90 else ("top-quartile" if rank_pct >= 75 else (
        "bottom-quartile" if rank_pct <= 25 else "mid-pack"))

    # Panel II subtitle — neutral, institutional tone
    rank_qualifier = (
        "strong" if rank_pct >= 75 else
        "above-average" if rank_pct >= 50 else
        "mid-to-lower quartile" if rank_pct >= 25 else
        "below-average"
    )
    alpha_quality_insight = (
        f"{ticker} generated +{target_res_er*100:.1f}% annualized L3 residual return "
        f"at {target_res_vol*100:.1f}% residual volatility — "
        f"{rank_qualifier} risk-adjusted alpha quality among {sub} peers."
    )

    # Risk DNA insight (Panel III)
    dna = _risk_dna_segments(data.metrics)
    sys_pct = dna["systematic_pct"]
    vol_pct = dna["vol"] * 100
    if sys_pct > 70:
        dna_insight = (
            f"{ticker}'s {vol_pct:.1f}% annualized vol is {sys_pct:.0f}% systematic — "
            f"risk is dominated by factor exposure, leaving limited idiosyncratic risk."
        )
    elif sys_pct < 40:
        dna_insight = (
            f"Only {sys_pct:.0f}% of {ticker}'s {vol_pct:.1f}% vol is systematic — "
            f"the stock is primarily driven by stock-specific (residual) risk."
        )
    else:
        dna_insight = (
            f"{ticker}'s {vol_pct:.1f}% vol splits {sys_pct:.0f}% systematic / "
            f"{100-sys_pct:.0f}% idiosyncratic."
        )

    # Unified top summary — integrates all 3 panels into a cohesive 2-sentence narrative
    p1d = data.p1
    tr_1y = p1d.tr_stock.get("1y")
    tr_spy = p1d.tr_spy.get("1y")

    if tr_1y is not None:
        pct_1y = tr_1y * 100
        sent1 = f"{ticker} delivered {pct_1y:+.1f}% total return over the past year"
        if tr_spy is not None:
            vs_spy = (tr_1y - tr_spy) * 100
            rel = "outperforming" if vs_spy > 0 else "underperforming"
            sent1 += f", {rel} SPY by {abs(vs_spy):.1f}pp"
        sent1 += f", driven largely by systematic factor exposure ({sys_pct:.0f}% of risk)."
    else:
        sent1 = f"{ticker}'s risk profile is {sys_pct:.0f}% systematic."

    res_sign = "+" if target_res_er >= 0 else ""
    sent2 = (
        f"Idiosyncratic alpha contributed {res_sign}{target_res_er*100:.1f}% ann. residual ER "
        f"but ranks {rank_qualifier} on a risk-adjusted basis among {sub} peers."
    )
    unified_summary = f"{sent1} {sent2}"

    # Dynamic "So What?" headline — template from env var or default
    import os as _os
    _HEADLINE_TPL = _os.environ.get(
        "RISKMODELS_HEADLINE_TEMPLATE",
        "{ticker}: {sys_drag} Systematic Exposure with {alpha_adj} Residual Alpha; {vs_bench} {sub}.",
    )

    tr_1y_bench = p1d.tr_subsector.get("1y") or p1d.tr_sector.get("1y")
    if tr_1y is not None and tr_1y_bench is not None:
        vs_bench_word = "Outperforming" if tr_1y > tr_1y_bench else "Underperforming"
    else:
        vs_bench_word = "vs"

    sys_drag = "High" if sys_pct > 65 else ("Moderate" if sys_pct > 40 else "Low")
    alpha_adj = "Strong" if rank_pct >= 60 else ("Solid" if rank_pct >= 40 else "Muted")

    headline = _HEADLINE_TPL.format(
        ticker=ticker, sys_drag=sys_drag, alpha_adj=alpha_adj,
        vs_bench=vs_bench_word, sub=sub,
    )

    return {
        "cum_insight": p1i.cum_insight,
        "alpha_quality_insight": alpha_quality_insight,
        "dna_insight": dna_insight,
        "summary": unified_summary,
        "headline": headline,
    }


# ---------------------------------------------------------------------------
# Page compositor
# ---------------------------------------------------------------------------

def _build_qr_pil(url: str, size_px: int):
    """Return a square RGB QR image, or None if ``qrcode`` is not installed.

    Resizes with nearest-neighbor only — :func:`SnapshotComposer.paste_image` uses
    LANCZOS by default, which blurs QR modules into an unreadable smear.
    """
    try:
        import qrcode
        from PIL import Image
        from qrcode import constants as qr_constants
    except ImportError:
        return None

    qr = qrcode.QRCode(
        version=None,
        error_correction=qr_constants.ERROR_CORRECT_M,
        box_size=4,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    pil = img.get_image() if hasattr(img, "get_image") else img
    pil = pil.convert("RGB")
    if pil.size != (size_px, size_px):
        try:
            resample = Image.Resampling.NEAREST
        except AttributeError:
            resample = Image.NEAREST  # Pillow < 9
        pil = pil.resize((size_px, size_px), resample)
    return pil


def _macro_corr_subtitle(macro_window: str) -> str:
    """Human-readable caption for macro correlation block (matches API fallback chain)."""
    if "gross" in macro_window:
        w = macro_window.replace(" gross", "").strip()
        return f"Gross return correlations · {w} trading days"
    if macro_window == "252d":
        return "Correlations vs L3 Residual Return · TTM (~252 trading days)"
    if macro_window == "126d":
        return "Correlations vs L3 Residual Return · ~126 trading days"
    if macro_window == "63d":
        return "Correlations vs L3 Residual Return · ~63 trading days"
    return f"Correlations vs L3 Residual Return · {macro_window}"


def _draw_card(
    page: SnapshotComposer,
    x: int, y: int, w: int, h: int,
    *,
    radius: int = 16,
    shadow_offset: int = 5,
    accent_left: bool = False,
) -> None:
    """Draw a white card with subtle shadow and optional navy left accent bar."""
    # Shadow
    page.draw.rounded_rectangle(
        [x + shadow_offset, y + shadow_offset,
         x + w + shadow_offset, y + h + shadow_offset],
        radius=radius, fill=(218, 224, 232),
    )
    # Card body
    page.draw.rounded_rectangle(
        [x, y, x + w, y + h],
        radius=radius, fill=(255, 255, 255), outline=(220, 225, 232),
    )
    # Optional navy left accent bar
    if accent_left:
        page.draw.rectangle([x, y + radius, x + 5, y + h - radius], fill=NAVY)


def _compose_dd_page(data: DDData) -> SnapshotComposer:
    """Compose the Stock Deep Dive using Pillow layout + Plotly/Matplotlib charts."""
    apply_theme()

    insights = _generate_dd_insights(data)
    p1  = data.p1      # shortcut to underlying P1Data
    m   = data.metrics  # goes through DDData.metrics property → p1.metrics
    pal = T.palette

    W, H    = 3300, 2550
    MARGIN  = 150
    PANEL_W = 800
    PANEL_GAP = 50
    CONTENT_X = MARGIN + PANEL_W + PANEL_GAP
    CONTENT_W = W - CONTENT_X - MARGIN

    page = SnapshotComposer(W, H)
    y = 80

    # ════════════════════════════════════════════════════════════════
    # HEADER — dynamic "So What?" headline
    # ════════════════════════════════════════════════════════════════
    page.text(MARGIN, y, insights.get("headline", f"{data.ticker} — {data.company_name}"),
              font_size=52, bold=True, color=NAVY, max_width=W - MARGIN * 2 - 500)
    y += 68

    page.text(MARGIN, y,
              f"{data.ticker} — {data.company_name}  ·  Subsector Benchmark: {data.subsector_label}  ·  As of: {data.teo}",
              font_size=30, color=TEXT_MID)
    y += 50

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
    ROW_H  = 44       # compressed from 48 to fit methodology box
    LBL_SZ = 27
    VAL_SZ = 27
    SEC_SZ = 21
    METH_BODY = 19     # methodology body (fits L1–L3 copy in sidebar)

    # Dynamic SECTION_GAP — distribute vertical space so sections fill the panel
    # and methodology is pinned to the panel bottom (METH_RESERVE px from footer).
    METH_RESERVE = 440   # methodology block: title + 6 definition rows
    PANEL_BOTTOM = H - 90
    _company_h   = int(38 * 1.4) + int(LBL_SZ * 1.4) + 10
    _sec_h       = int(SEC_SZ * 1.4) + 7   # section header + divider
    _identity_h  = _sec_h + 3 * ROW_H
    _perf_h      = _sec_h + 5 * ROW_H
    # Rankings: combined title + col headers + up to 6 window rows (no header rules)
    _rankings_h  = int((SEC_SZ + 1) * 1.4) * 2 + 10 + int(17 * 1.35) + 10 + 6 * 36
    # ER rows may wrap to 2 lines — reserve extra vertical space vs single ROW_H
    _risk_h      = _sec_h + 4 * max(ROW_H, int(LBL_SZ * 1.4 * 2) + 4)
    _macro_h     = _sec_h + 6 * ROW_H
    _sections_h  = _company_h + _identity_h + _perf_h + _rankings_h + _risk_h + _macro_h
    _n_gaps      = 5   # gaps: after identity, perf, rankings, risk, macro→meth
    _avail       = (PANEL_BOTTOM - METH_RESERVE) - (py + _sections_h)
    # Narrow band so vertical rhythm between Identity / Perf / Rankings / Risk / Macro is even
    SECTION_GAP  = max(30, min(52, _avail // _n_gaps))

    def _panel_row(label: str, val_str: str, val_color=TEXT_DARK):
        nonlocal py
        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_LIGHT)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)
        py += ROW_H

    def _section(title: str):
        nonlocal py
        page.text(MARGIN, py, title, font_size=SEC_SZ + 1, bold=True, color=TEXT_DARK)
        py += int((SEC_SZ + 1) * 1.4)
        page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
        py += 6        # compressed from 8

    # Company name + ticker/date
    page.text(MARGIN, py, data.company_name,
              font_size=38, bold=True, color=NAVY, max_width=PANEL_W)
    py += int(38 * 1.4)
    page.text(MARGIN, py, f"{data.ticker}  ·  {data.teo}",
              font_size=LBL_SZ, color=TEXT_MID)
    py += int(LBL_SZ * 1.4) + 10

    # IDENTITY
    _section("IDENTITY")
    mkt_cap_str = _fmt_market_cap(m.get("market_cap"))
    _panel_row("Market Cap",     mkt_cap_str)
    _panel_row("Sector ETF",     data.sector_etf or "—")
    _panel_row("Subsector ETF",  data.subsector_etf or "—")
    py += SECTION_GAP

    # PERFORMANCE STATS (with sparklines for price & Sharpe)
    _section("PERFORMANCE STATS")
    vol_str    = f"{p1.vol_23d*100:.1f}%" if p1.vol_23d else "—"
    _sh = p1.sharpe_1y
    sharpe_str = _fmt_num(_sh)   # qualifier rendered as sub-label below
    max_dd_str = _fmt_pct(p1.max_drawdown)
    price = m.get("close_price")
    price_str = f"${float(price):.2f}" if price else "—"

    def _draw_sparkline(
        values: list[float], x0: int, y0: int, w: int = 100, h: int = 24,
        color: tuple = TEAL,
    ) -> None:
        """Draw a tiny trend line using raw Pillow line segments."""
        if len(values) < 3:
            return
        mn, mx = min(values), max(values)
        rng = mx - mn or 1e-9
        pts = []
        for i, v in enumerate(values):
            px = x0 + int(i / (len(values) - 1) * w)
            py_s = y0 + h - int((v - mn) / rng * h)
            pts.append((px, py_s))
        for j in range(len(pts) - 1):
            page.draw.line([pts[j], pts[j + 1]], fill=color, width=2)

    # Extract last 30 days of price for sparkline
    _price_spark: list[float] = []
    if p1.cum_stock:
        _price_spark = [1.0 + r[1] for r in p1.cum_stock[-30:]]

    # Extract last 30 days of rolling sharpe approximation from residual cumsum
    _sharpe_spark: list[float] = []
    if p1.l3_er_series and len(p1.l3_er_series) >= 30:
        _recent_res = [r[4] for r in p1.l3_er_series[-63:]]
        for i in range(max(0, len(_recent_res) - 30), len(_recent_res)):
            _win = _recent_res[max(0, i - 20):i + 1]
            if len(_win) >= 5:
                _m = sum(_win) / len(_win)
                _s = (sum((x - _m) ** 2 for x in _win) / len(_win)) ** 0.5
                _sharpe_spark.append(_m / _s if _s > 1e-9 else 0)

    SPARK_X = MARGIN + int(PANEL_W * 0.50)  # mid-panel — clear of both label and value text
    SPARK_W = 90
    SPARK_H = 22

    _panel_row("Last Price",     price_str)
    if _price_spark:
        _trend_color = GREEN_RGB if _price_spark[-1] >= _price_spark[0] else ORANGE_RGB
        _draw_sparkline(_price_spark, SPARK_X, py - ROW_H + 6, SPARK_W, SPARK_H, _trend_color)

    _panel_row("Vol (23d ann.)", vol_str)
    _sh_color = GREEN_RGB if (_sh or 0) > 0.5 else ORANGE_RGB if (_sh or 0) < 0 else TEXT_DARK
    _panel_row("Sharpe (63d)",   sharpe_str, val_color=_sh_color)
    if _sh is not None:
        _sq = _sharpe_qualifier(_sh)
        page.text_right(panel_right, py - ROW_H + 26, _sq, font_size=19, color=_sh_color)
    if _sharpe_spark:
        _trend_color = GREEN_RGB if _sharpe_spark[-1] >= _sharpe_spark[0] else ORANGE_RGB
        _draw_sparkline(_sharpe_spark, SPARK_X, py - ROW_H + 6, SPARK_W, SPARK_H, _trend_color)

    _panel_row("Max Drawdown",   max_dd_str,
               val_color=ORANGE_RGB if (p1.max_drawdown or 0) < -0.15 else TEXT_DARK)

    # Residual Alpha DD
    res_dd = _residual_dd_series(p1.l3_er_series)
    max_res_dd = min((v for _, v in res_dd), default=None) if res_dd else None
    _panel_row("Res α Max DD",   _fmt_pct(max_res_dd),
               val_color=ORANGE_RGB if (max_res_dd or 0) < -0.05 else TEXT_DARK)
    py += SECTION_GAP

    # RANKINGS — title + peer cohort on one line, then table
    _rank_1y = p1.rankings.get("252d_subsector_gross_return")
    _cohort_n = int(_rank_1y["cohort_size"]) if (_rank_1y and _rank_1y.get("cohort_size")) else None
    _rank_title = "RANKINGS — Subsector cohort"
    if _cohort_n:
        _rank_title = (
            f"{_rank_title}  ·  Peer group: {_cohort_n} stocks in {data.subsector_label}"
        )
    _rt0 = py
    py = page.text(
        MARGIN, _rt0, _rank_title,
        font_size=SEC_SZ + 1, bold=True, color=TEXT_DARK, max_width=PANEL_W - 10,
    )
    py += 10

    RANK_WINDOWS = [
        ("1d", "1 day"),
        ("5d", "5 days"),
        ("21d", "1 month"),
        ("63d", "3 months"),
        ("126d", "6 months"),
        ("252d", "1 year"),
    ]
    # Keys: {window}_subsector_gross_return, {window}_subsector_subsector_residual
    RANK_SUFFIXES = ("gross_return", "subsector_residual")

    # Column header: window (left) | explicit rank labels (values right-aligned)
    col1_x = MARGIN
    col2_right = MARGIN + int(PANEL_W * 0.58)
    col3_right = panel_right
    HDR_SZ = 17
    page.text(col1_x, py, "Window", font_size=HDR_SZ, bold=True, color=NAVY)
    page.text_right(
        col2_right, py,
        "Gross Return Rank",
        font_size=HDR_SZ, bold=True, color=NAVY,
    )
    page.text_right(
        col3_right, py,
        "Explained Risk (ER)",
        font_size=HDR_SZ, bold=True, color=NAVY,
    )
    py += int(HDR_SZ * 1.35) + 2
    py += 8

    RANK_ROW_H = 36
    for wkey, dlabel in RANK_WINDOWS:
        # Skip rows where both metrics are missing
        _has_any = False
        for rank_suffix in RANK_SUFFIXES:
            rrow = p1.rankings.get(f"{wkey}_subsector_{rank_suffix}")
            if rrow and rrow.get("rank_percentile") is not None:
                _has_any = True
                break
        if not _has_any:
            continue

        page.text(
            col1_x, py, dlabel, font_size=LBL_SZ, bold=True, color=TEXT_DARK,
            max_width=col2_right - col1_x - 8,
        )
        for col_right, rank_suffix in [(col2_right, RANK_SUFFIXES[0]), (col3_right, RANK_SUFFIXES[1])]:
            rank_key = f"{wkey}_subsector_{rank_suffix}"
            rrow = p1.rankings.get(rank_key)
            pct = float(rrow["rank_percentile"]) if (
                rrow and rrow.get("rank_percentile") is not None
            ) else None
            if pct is not None:
                pct_str = _pct_ordinal(pct)
                pct_color = (
                    GREEN_RGB if pct >= 67 else
                    RED_RGB   if pct <= 33 else
                    TEXT_DARK
                )
            else:
                pct_str = "—"
                pct_color = TEXT_LIGHT
            page.text_right(col_right, py, pct_str, font_size=LBL_SZ, bold=True, color=pct_color)
        py += RANK_ROW_H
    py += SECTION_GAP

    # RISK DECOMPOSITION
    _section("RISK DECOMPOSITION — L3 Explained Risk")
    BAR_MAX_W = int(PANEL_W * 0.45)
    VAL_RAIL_W = 132
    BAR_TO_VALUE_GAP = 30
    # Wider label column so "Market explained risk (SPY)" fits on one line when possible
    BAR_LABEL_EDGE = MARGIN + 420
    _sec_etf = data.sector_etf or "—"
    _sub_etf = data.subsector_etf or "—"

    def _ge(full: str, abbr: str) -> float | None:
        v = m.get(full)
        return v if v is not None else m.get(abbr)

    mkt_er  = _ge("l3_market_er",    "l3_mkt_er")
    sec_er  = _ge("l3_sector_er",    "l3_sec_er")
    sub_er  = _ge("l3_subsector_er", "l3_sub_er")
    res_er  = _ge("l3_residual_er",  "l3_res_er")
    er_vals = [abs(float(v)) for v in [mkt_er, sec_er, sub_er, res_er] if v is not None]
    max_er  = max(er_vals) if er_vals else 1.0

    NAVY_T  = (0, 42, 94)
    TEAL_T  = (0, 111, 142)
    SLATE_T = (42, 127, 191)
    GREEN_T = (0, 170, 0)

    def _er_color(v: float | None) -> tuple:
        if v is None:
            return TEXT_LIGHT
        return GREEN_RGB if float(v) >= 0 else ORANGE_RGB

    _label_max_w = BAR_LABEL_EDGE - MARGIN - 8
    for er_label, er_val, bar_color in [
        (f"Market explained risk (SPY)",       mkt_er, NAVY_T),
        (f"Sector explained risk ({_sec_etf})", sec_er, TEAL_T),
        (f"Subsector explained risk ({_sub_etf})", sub_er, SLATE_T),
        ("Residual explained risk (idiosyncratic)", res_er, GREEN_T),
    ]:
        val_str = _fmt_pct(er_val) if er_val is not None else "—"
        vc = _er_color(er_val)
        row_y0 = py
        # page.text with wrap returns y below last line — must drive row height (see _compose.SnapshotComposer.text)
        py = page.text(
            MARGIN, row_y0, er_label, font_size=LBL_SZ, color=TEXT_LIGHT,
            max_width=_label_max_w,
        )
        row_h = max(ROW_H, py - row_y0 + 6)
        val_y = row_y0 + (row_h - VAL_SZ) // 2
        bar_y = row_y0 + (row_h - 9) // 2
        page.text_right(panel_right, val_y, val_str, font_size=VAL_SZ, bold=True, color=vc)
        if er_val is not None:
            bar_h = 9
            bar_anchor_right = panel_right - VAL_RAIL_W - BAR_TO_VALUE_GAP
            bar_w = max(4, int(abs(float(er_val)) / max_er * BAR_MAX_W))
            bar_w = min(bar_w, max(4, bar_anchor_right - BAR_LABEL_EDGE))
            bar_x = bar_anchor_right - bar_w
            page.draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=bar_color)
        py = row_y0 + row_h
    py += 10

    # MACRO CORRELATIONS
    _section("MACRO CORRELATIONS — L3 Residual Return")
    py = page.text(
        MARGIN, py, _macro_corr_subtitle(p1.macro_window),
        font_size=19, color=TEXT_LIGHT, max_width=PANEL_W - 20,
    )
    py += 10
    MACRO_KEYS  = ["vix", "oil", "gold", "bitcoin", "dxy", "ust10y2y"]
    MACRO_NAMES = {"vix": "VIX", "oil": "Oil", "gold": "Gold",
                   "bitcoin": "Bitcoin", "dxy": "DXY", "ust10y2y": "UST 10y-2y"}
    corrs = p1.macro_correlations or {}
    for mkey in MACRO_KEYS:
        corr = corrs.get(mkey)
        mlabel = MACRO_NAMES[mkey]
        if corr is not None:
            corr_f = float(corr)
            val_str = f"{corr_f:+.2f}"
            val_color = GREEN_RGB if corr_f > 0 else ORANGE_RGB
        else:
            corr_f = None
            val_str = "—"
            val_color = TEXT_LIGHT
        page.text(MARGIN, py, mlabel, font_size=LBL_SZ, color=TEXT_LIGHT)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)
        if corr_f is not None:
            bar_h, bar_y = 9, py + (ROW_H - 9) // 2
            bar_anchor_right = panel_right - VAL_RAIL_W - BAR_TO_VALUE_GAP
            bar_w = max(4, int(abs(corr_f) * BAR_MAX_W))
            bar_w = min(bar_w, max(4, bar_anchor_right - BAR_LABEL_EDGE))
            bar_x = bar_anchor_right - bar_w
            page.draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=val_color)
        py += ROW_H

    # ── METHODOLOGY — pinned to panel bottom ──────────────────────────
    py = PANEL_BOTTOM - METH_RESERVE
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 8
    page.text(
        MARGIN, py,
        "METHODOLOGY — Hierarchical regression (ERM3)",
        font_size=SEC_SZ + 1, bold=True, color=TEXT_DARK,
    )
    py += int((SEC_SZ + 1) * 1.4)

    _meth_rows = [
        ("L1", "Market — stock vs SPY; baseline market beta (incremental hedge ratios)."),
        ("L2", "Sector — L1 residual vs GICS sector ETF; sector-specific vs the market."),
        ("L3", "Subsector — L2 residual vs subsector ETF; finest systematic sleeve before idiosyncratic risk."),
        ("ER", "Explained Risk (ER) — variance share of each orthogonal factor layer."),
        ("HR", "Hedge Ratio (HR) — dollars of ETF hedge per $1 of stock."),
        ("RR", "Residual Return (RR) — return orthogonal to market, sector, and subsector factors."),
    ]
    for _tag, _desc in _meth_rows:
        py = page.text(
            MARGIN, py, f"{_tag} — {_desc}",
            font_size=METH_BODY, color=TEXT_MID, max_width=PANEL_W - 20,
        )
        py += 4
    py += 6

    # ════════════════════════════════════════════════════════════════
    # RIGHT CONTENT AREA
    # ════════════════════════════════════════════════════════════════
    y = after_header_y
    FOOTER_Y = H - 90
    half_w   = CONTENT_W // 2 - 20
    GAP      = 36
    CARD_PAD = 14   # inner padding for chart cards

    # ── AI Summary Box (card with accent bar) ─────────────────────
    if insights["summary"]:
        def _est_lines(text: str, fs: int, mw: int) -> int:
            if not text:
                return 0
            cpl = max(1, int(mw / (fs * 0.55)))
            words, lines, ll = text.split(), 1, 0
            for w in words:
                if ll + len(w) + 1 > cpl:
                    lines += 1; ll = len(w)
                else:
                    ll += len(w) + 1
            return lines

        summary_text = insights["summary"]
        lines = _est_lines(summary_text, 30, CONTENT_W - 50)
        box_h = 26 + int(lines * 30 * 1.4) + 26
        box_h = max(box_h, 90)

        _draw_card(page, CONTENT_X - 10, y, CONTENT_W + 20, box_h, accent_left=True)
        page.text(CONTENT_X + 14, y + 22, summary_text,
                  font_size=30, bold=True, color=TEXT_DARK, max_width=CONTENT_W - 50)
        y += box_h + 16

    # Compute chart layout
    OVERHEAD = 96 + 21 + 96   # section headers + divider + section headers
    chart_area = FOOTER_Y - y - OVERHEAD - GAP
    chart_h_top = int(chart_area * 0.50)
    chart_h_bot = chart_area - chart_h_top

    # ── Section I: Cumulative Returns (in card) ────────────────────
    sec1_h = 56 + 40 + chart_h_top + CARD_PAD * 2
    _draw_card(page, CONTENT_X - CARD_PAD, y - CARD_PAD,
               CONTENT_W + CARD_PAD * 2, sec1_h)

    page.text(CONTENT_X, y, "I. Cumulative Returns",
              font_size=38, bold=True, color=NAVY)
    y += 56
    page.text(CONTENT_X, y, insights["cum_insight"],
              font_size=26, italic=True, color=TEAL, max_width=CONTENT_W - 20)
    y += 40

    cum_fig = _make_dd_cum_chart(p1)
    page.paste_figure(cum_fig, CONTENT_X, y, CONTENT_W, chart_h_top)
    y += chart_h_top + GAP + CARD_PAD

    # ── Sections II + III side by side (each in a card) ─────────────
    sec23_title_h = 56 + 40
    sec23_card_h = sec23_title_h + chart_h_bot + CARD_PAD * 2

    # Card II
    _draw_card(page, CONTENT_X - CARD_PAD, y - CARD_PAD,
               half_w + CARD_PAD * 2, sec23_card_h)
    # Card III
    _draw_card(page, CONTENT_X + half_w + 40 - CARD_PAD, y - CARD_PAD,
               half_w + CARD_PAD * 2, sec23_card_h)

    page.text(CONTENT_X, y, "II. L3 Residual Alpha Quality",
              font_size=38, bold=True, color=NAVY)
    page.text(CONTENT_X + half_w + 40, y, "III. Equity Factor Decomposition",
              font_size=38, bold=True, color=NAVY)
    y += 56

    page.text(CONTENT_X, y, insights["alpha_quality_insight"],
              font_size=26, italic=True, color=TEAL, max_width=half_w - 20)
    page.text(CONTENT_X + half_w + 40, y, insights["dna_insight"],
              font_size=26, italic=True, color=TEAL, max_width=half_w - 20)
    y += 40

    # II. L3 Residual Alpha Quality scatter (Plotly)
    scatter_fig = _make_alpha_quality_scatter(data)
    page.paste_figure(scatter_fig, CONTENT_X, y, half_w, chart_h_bot)

    # III. Equity Factor Decomposition (Matplotlib → PIL, target + top 6 peers)
    dna_img = _make_peer_dna_chart(data)
    page.paste_image(dna_img, CONTENT_X + half_w + 40, y, half_w, chart_h_bot)

    # ════════════════════════════════════════════════════════════════
    # FOOTER + QR Code
    # ════════════════════════════════════════════════════════════════
    _ticker_url = f"riskmodels.app/ticker/{data.ticker.lower()}"
    _display_ticker_url = f"RiskModels.app/ticker/{data.ticker.lower()}"
    _full_url = f"https://{_ticker_url}?ref=snapshot_{data.teo}"

    # QR code — bottom-right, above footer line (pre-sized; do not LANCZOS-resize in paste_image)
    QR_SIZE = 120
    _qr_url = f"https://{_ticker_url}?ref=qr_{data.teo}"
    _qr_pil = _build_qr_pil(_qr_url, QR_SIZE)
    if _qr_pil is not None:
        page.paste_image(_qr_pil, W - MARGIN - QR_SIZE, H - 80 - QR_SIZE - 16)
    else:
        warnings.warn(
            "QR code skipped: install snapshot extras "
            "(pip install 'riskmodels-py[snapshots]' or pip install 'qrcode[pil]>=7').",
            UserWarning,
            stacklevel=2,
        )

    footer_y = H - 80
    page.hline(footer_y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=2)
    footer_y += 12
    page.text(MARGIN, footer_y,
              f"ERM3 V3 · {data.teo}  ·  {_display_ticker_url}",
              font_size=24, color=TEXT_LIGHT)
    page.text_right(W - MARGIN, footer_y,
                    "Blue Water Macro Corp · Confidential · Not Investment Advice",
                    font_size=24, color=TEXT_LIGHT)

    return page


# ---------------------------------------------------------------------------
# Public render API
# ---------------------------------------------------------------------------

def render_dd_to_pdf(data: DDData, output_path: str | Path) -> Path:
    """Render the Stock Deep Dive snapshot to a PDF file."""
    page = _compose_dd_page(data)
    return page.save(output_path)


def render_dd_to_png(data: DDData, output_path: str | Path) -> Path:
    """Render the Stock Deep Dive snapshot to a PNG file."""
    page = _compose_dd_page(data)
    return page.save(output_path)


def render_dd_to_png_bytes(data: DDData) -> bytes:
    """Render the Stock Deep Dive snapshot to PNG bytes in memory."""
    page = _compose_dd_page(data)
    return page.to_png_bytes()
