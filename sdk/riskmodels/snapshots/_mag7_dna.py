"""MAG7-style risk-DNA horizontal stacked bars — Plotly version.

Renders L3 orthogonal variance attribution (Market / Sector / Subsector /
Idiosyncratic) for a list of tickers, with bar width proportional to
annualized σ, so each segment width = σ · variance_share.

Optional right-side panel shows the equal-weight portfolio's naive vs
correlation-adjusted decomposition — the "diversification collapse" exhibit.
Naive is the position-weighted sum of individual risk; adjusted is the
portfolio-level risk after cross-stock correlation. The drop in the
Idiosyncratic layer is the diversification credit.

Pure rendering. Takes pre-computed dicts; does no API calls.

Row dict shape
--------------
    {
      "ticker":         str,
      "mkt_var":        float,    # fraction of total variance
      "sec_var":        float,
      "sub_var":        float,
      "res_var":        float,
      "sigma":          float,    # annualized σ of gross return
      "subsector_etf":  str | None,
      "sector_etf":     str | None,
    }

Diversification dict shape (optional)
-------------------------------------
    {
      "layers": [
        {"layer": "market"|"sector"|"subsector"|"residual",
         "naive_er": float, "adjusted_er": float, "multiplier": float},
        ...
      ],
    }
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import plotly.graph_objects as go
from plotly.subplots import make_subplots

from ._plotly_theme import PLOTLY_THEME as T, apply_theme

_LAYER_COLORS = {
    "market":       None,   # resolved at render time from theme palette
    "sector":       None,
    "subsector":    None,
    "residual":     None,
}


def _layer_colors() -> dict[str, str]:
    return {
        "market":    "#3B82F6",
        "sector":    "#14B8A6",
        "subsector": "#F97316",
        "residual":  "#94A3B8",
    }


def row_from_p1(p1: Any) -> dict[str, Any]:
    """Extract a MAG7-DNA row dict from a P1Data-like object."""
    m = p1.metrics

    def _g(k: str, default: float = 0.0) -> float:
        v = m.get(k)
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    mkt = _g("l3_mkt_er")
    sec = _g("l3_sec_er")
    sub = _g("l3_sub_er")
    res = _g("l3_res_er")

    sigma = _g("vol_23d")
    if sigma <= 0:
        daily_var = _g("stock_var")
        sigma = math.sqrt(daily_var * 252) if daily_var > 0 else 0.0

    return {
        "ticker": p1.ticker,
        "mkt_var": mkt,
        "sec_var": sec,
        "sub_var": sub,
        "res_var": res,
        "sigma": sigma,
        "sector_etf": p1.sector_etf,
        "subsector_etf": p1.subsector_etf,
    }


def render_mag7_dna(
    rows: list[dict[str, Any]],
    out_path: str | Path,
    *,
    diversification: dict[str, Any] | None = None,
    title: str | None = None,
    subtitle: str = "L3 explained risk — bar width ∝ annualized total risk (σ)",
    diversification_title: str = "Equal-weight portfolio",
    annotation_mode: str = "idiosyncratic",
    width: int = 1400,
    height: int = 780,
    scale: int = 2,
) -> Path:
    """Render the MAG7 DNA chart (optionally with a diversification panel) to PNG."""
    apply_theme()
    out_path = Path(out_path)
    pal = T.palette
    fnt = T.fonts
    # Larger type for print / PDF embedding (headers + all axis copy).
    _axis_title_sz = max(16, fnt.axis_label + 5)
    _axis_tick_sz = max(14, fnt.axis_tick + 4)
    _dna_ytick_sz = max(16, _axis_tick_sz + 2)

    _sub_left = "<b>Per-ticker DNA</b> — σ-scaled risk attribution"
    # Two lines + wider col-2 so the right header is not clipped at the panel edge.
    _sub_right = (
        f"<b>{diversification_title}</b><br>"
        "<span style='font-size:92%'>naive vs diversified</span>"
    )

    if diversification is not None:
        fig = make_subplots(
            rows=1, cols=2,
            column_widths=[0.72, 0.28],
            horizontal_spacing=0.055,
            subplot_titles=[_sub_left, _sub_right],
        )
        _add_dna_panel(
            fig, rows, annotation_mode, col=1,
            axis_title_size=_axis_title_sz,
            axis_tick_size=_axis_tick_sz,
            y_category_size=_dna_ytick_sz,
        )
        _add_diversification_panel(
            fig, diversification, col=2,
            axis_title_size=_axis_title_sz,
            axis_tick_size=_axis_tick_sz,
        )
        _style_mag7_subplot_titles(fig, _sub_left, _sub_right, fnt, pal)
    else:
        fig = make_subplots(rows=1, cols=1)
        _add_dna_panel(
            fig, rows, annotation_mode, col=1,
            axis_title_size=_axis_title_sz,
            axis_tick_size=_axis_tick_sz,
            y_category_size=_dna_ytick_sz,
        )

    T.style(fig)

    # Half-frame dark axis convention (applied AFTER T.style so BOTH
    # subplots pick up the override — T.style uses update_layout(xaxis=…)
    # which only targets subplot 1 and would otherwise leave subplot 2
    # with the global Tufte-faint axis).
    n_cols = 2 if diversification is not None else 1
    _spine_w = 0.45  # ~60% thinner than 1.2px Tufte default read
    for col_idx in range(1, n_cols + 1):
        fig.update_xaxes(
            showline=True, linecolor="#475569", linewidth=_spine_w, mirror=False,
            row=1, col=col_idx,
        )
        fig.update_yaxes(
            showline=True, linecolor="#475569", linewidth=_spine_w, mirror=False,
            row=1, col=col_idx,
        )

    _main_title_pt = max(26, fnt.page_title + 8)
    _subtitle_pt = max(16, fnt.body + 4)
    _title_html = (
        (f"<b>{title}</b><br>" if title else "")
        + f"<span style='font-size:{_subtitle_pt}px;color:{pal.teal};font-weight:normal'>{subtitle}</span>"
    )
    # Main header via layout.title (centered, paper-coord, y controls vertical
    # placement within the expanded top margin). Keeping it out of annotations
    # avoids collisions with the per-panel subplot titles at domain y=1.03.
    _layout_title = dict(text="")
    if _title_html.strip():
        _layout_title = dict(
            text=_title_html,
            x=0.5,
            xref="paper",
            xanchor="center",
            y=0.965,
            yref="container",
            yanchor="top",
            pad=dict(t=18, b=0),
            font=dict(family=fnt.family, size=_main_title_pt, color=pal.navy),
        )

    fig.update_layout(
        barmode="stack",
        bargap=0.32,
        title=_layout_title,
        legend=dict(
            orientation="h",
            yanchor="top",
            y=-0.18,
            xanchor="center", x=0.5,
            bgcolor="rgba(0,0,0,0)", borderwidth=0,
            font=dict(size=max(14, fnt.body + 3), family=fnt.family),
            traceorder="normal",
        ),
        showlegend=True,
        height=height, width=width,
        # Widened top margin: main title + per-panel subplot titles each need
        # their own vertical band. 260px = main title ~(18 + 2*30) + subplot
        # title band ~40px + breathing room.
        margin=dict(t=260, b=152, l=72, r=52),
        plot_bgcolor="white",
        paper_bgcolor="white",
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.write_image(str(out_path), scale=scale)
    return out_path


# ── Per-ticker DNA panel ───────────────────────────────────────────────────

def _style_mag7_subplot_titles(
    fig: go.Figure,
    left_html: str,
    right_html: str,
    fnt: Any,
    pal: Any,
) -> None:
    """Left panel title: left-aligned over its x-domain. Right: centered, two-line safe."""
    _st_font = dict(family=fnt.family, size=max(17, fnt.panel_title + 4), color=pal.text_dark, weight=600)
    _st_font_r = {**_st_font, "size": max(15, fnt.panel_title + 2)}
    # make_subplots(subplot_titles=…) prepends title annotations; do not rely on
    # string equality (Plotly may normalize HTML) — avoids duplicate/garbled titles.
    _ann = fig.layout.annotations
    if len(_ann) >= 2:
        _ann[0].update(
            text=left_html,
            xref="x domain",
            yref="y domain",
            x=0.0,
            xanchor="left",
            y=1.03,
            yanchor="bottom",
            font=_st_font,
        )
        _ann[1].update(
            text=right_html,
            xref="x2 domain",
            yref="y2 domain",
            x=0.5,
            xanchor="center",
            y=1.04,
            yanchor="bottom",
            font=_st_font_r,
        )


def _add_dna_panel(
    fig: go.Figure,
    rows: list[dict[str, Any]],
    annotation_mode: str,
    *,
    col: int,
    axis_title_size: int,
    axis_tick_size: int,
    y_category_size: int,
) -> None:
    pal = T.palette
    fnt = T.fonts
    colors = _layer_colors()

    tickers = [r["ticker"] for r in rows]

    def _seg(key: str) -> list[float]:
        return [float(r["sigma"]) * float(r[key]) * 100 for r in rows]

    mkt = _seg("mkt_var")
    sec = _seg("sec_var")
    sub = _seg("sub_var")
    res = _seg("res_var")
    totals = [a + b + c + d for a, b, c, d in zip(mkt, sec, sub, res)]

    stacks = [
        ("Market",       mkt, colors["market"]),
        ("Sector",       sec, colors["sector"]),
        ("Subsector",    sub, colors["subsector"]),
        ("Idiosyncratic", res, colors["residual"]),
    ]
    for label, vals, color in stacks:
        fig.add_trace(
            go.Bar(
                y=tickers, x=vals,
                name=label,
                orientation="h",
                marker=dict(color=color, line=dict(color="white", width=0.8)),
                legendgroup=label,
                hovertemplate=f"<b>%{{y}}</b><br>{label}: %{{x:.1f}}%<extra></extra>",
            ),
            row=1, col=col,
        )

    x_max = max(totals) * 1.06 if totals else 1.0
    fig.update_xaxes(
        range=[0, x_max],
        ticksuffix="%",
        title=dict(
            text=(
                "Annualized σ of total return<br>"
                "<span style='font-size:92%'>segments = σ × explained-risk share</span>"
            ),
            standoff=10,
            font=dict(
                size=axis_title_size, color=pal.text_dark, family=fnt.family, weight=600,
            ),
        ),
        tickfont=dict(
            family=fnt.family, size=axis_tick_size, color=pal.text_dark, weight=600,
        ),
        row=1, col=col,
    )
    fig.update_yaxes(
        autorange="reversed",
        tickfont=dict(
            family=fnt.family, size=y_category_size, color=pal.navy, weight=600,
        ),
        row=1, col=col,
    )
    _ = annotation_mode  # kept for backwards compat; right-rail labels removed


# ── Diversification panel ──────────────────────────────────────────────────

def _add_diversification_panel(
    fig: go.Figure,
    div: dict[str, Any],
    *,
    col: int,
    axis_title_size: int,
    axis_tick_size: int,
) -> None:
    """Two stacked bars: naive (weighted sum) vs adjusted (correlation-diversified)."""
    pal = T.palette
    fnt = T.fonts
    colors = _layer_colors()
    layer_order = ["market", "sector", "subsector", "residual"]
    layer_label = {
        "market": "Market", "sector": "Sector",
        "subsector": "Subsector", "residual": "Idiosyncratic",
    }

    # Index layers from the API payload by name
    by_layer = {l["layer"].lower(): l for l in div.get("layers", [])}
    x_cats = ["Naive", "Adjusted"]

    naive_totals = [0.0, 0.0]
    for key in layer_order:
        lr = by_layer.get(key) or {}
        n = float(lr.get("naive_er") or 0.0)
        a = float(lr.get("adjusted_er") or 0.0)
        vals = [n * 100, a * 100]

        fig.add_trace(
            go.Bar(
                x=x_cats, y=vals,
                name=layer_label[key],
                marker=dict(color=colors[key], line=dict(color="white", width=0.8)),
                legendgroup=layer_label[key],
                showlegend=False,   # already in left-panel legend
                hovertemplate=f"<b>%{{x}}</b><br>{layer_label[key]}: %{{y:.1f}}%<extra></extra>",
                text=[
                    f"{vals[0]:.0f}%" if vals[0] >= 4 else None,
                    f"{vals[1]:.0f}%" if vals[1] >= 4 else None,
                ],
                textposition="inside",
                insidetextfont=dict(color="white", size=max(13, fnt.body + 2)),
                cliponaxis=False,
            ),
            row=1, col=col,
        )
        naive_totals = [naive_totals[0] + vals[0], naive_totals[1] + vals[1]]

    # Total annotations above each bar
    for i, (cat, tot) in enumerate(zip(x_cats, naive_totals)):
        fig.add_annotation(
            x=cat, y=tot,
            text=f"<b>{tot:.0f}%</b>",
            showarrow=False, yanchor="bottom", yshift=3,
            xref=_axis_ref("x", col), yref=_axis_ref("y", col),
            font=dict(family=fnt.family, size=fnt.body + 4, color=pal.navy, weight=600),
        )

    # Credit callout sits below the right panel's x-tick labels, above the
    # figure-wide legend. Using domain references with a modest negative y so
    # it stays within paper bounds and doesn't collide with inside-bar labels.
    credit = div.get("diversification_credit", {})
    total_credit = credit.get("total")
    if total_credit is not None:
        try:
            credit_pct = float(total_credit) * 100
            # Paper coords: keeps callout under the right panel without domain
            # math that can mis-place text (e.g. stray glyphs in a far corner).
            fig.add_annotation(
                xref="paper",
                yref="paper",
                x=0.86,
                y=0.055,
                text=(f"<span style='color:{pal.green}'>▼</span> "
                      f"<b>{credit_pct:.0f}% diversification credit</b>"),
                showarrow=False,
                xanchor="center",
                yanchor="bottom",
                font=dict(family=fnt.family, size=15, color=pal.navy, weight=600),
            )
        except (TypeError, ValueError):
            pass

    y_top = max(naive_totals) * 1.18 if any(naive_totals) else 100
    fig.update_xaxes(
        tickfont=dict(
            family=fnt.family, size=axis_tick_size, color=pal.text_dark, weight=600,
        ),
        row=1, col=col,
    )
    fig.update_yaxes(
        range=[0, y_top],
        ticksuffix="%",
        title=dict(
            text="Explained Risk",
            font=dict(
                size=axis_title_size, color=pal.text_dark, family=fnt.family, weight=600,
            ),
        ),
        tickfont=dict(
            family=fnt.family, size=axis_tick_size, color=pal.text_dark, weight=600,
        ),
        row=1, col=col,
    )


def _axis_ref(kind: str, col: int) -> str:
    return kind if col == 1 else f"{kind}{col}"
