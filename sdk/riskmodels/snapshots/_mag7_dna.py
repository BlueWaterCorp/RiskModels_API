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
    pal = T.palette
    return {
        "market":    pal.navy,
        "sector":    pal.teal,
        "subsector": pal.slate,
        "residual":  "#94a3b8",
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
    width: int = 1500,
    height: int = 580,
    scale: int = 2,
) -> Path:
    """Render the MAG7 DNA chart (optionally with a diversification panel) to PNG."""
    apply_theme()
    out_path = Path(out_path)
    pal = T.palette
    fnt = T.fonts

    if diversification is not None:
        fig = make_subplots(
            rows=1, cols=2,
            column_widths=[0.74, 0.26],
            horizontal_spacing=0.10,
            subplot_titles=[
                "<b>Per-ticker DNA</b> — σ-scaled variance decomposition",
                f"<b>{diversification_title}</b> — naive vs diversified",
            ],
        )
        _add_dna_panel(fig, rows, annotation_mode, col=1)
        _add_diversification_panel(fig, diversification, col=2)
        for ann in fig.layout.annotations:
            if ann.text and ann.text.startswith("<b>"):
                ann.yanchor = "bottom"
                ann.font = dict(family=fnt.family, size=12, color=pal.text_mid)
    else:
        fig = make_subplots(rows=1, cols=1)
        _add_dna_panel(fig, rows, annotation_mode, col=1)

    T.style(fig)

    fig.update_layout(
        barmode="stack",
        bargap=0.32,
        title=dict(
            text=(
                (f"<b>{title}</b><br>" if title else "")
                + f"<span style='font-size:13px;color:{pal.teal};font-weight:normal'>{subtitle}</span>"
            ),
            x=0.01, xanchor="left",
            y=0.965, yanchor="top",
            font=dict(size=18, color=pal.navy),
        ),
        legend=dict(
            orientation="h",
            yanchor="bottom", y=-0.22,
            xanchor="center", x=0.5,
            bgcolor="rgba(0,0,0,0)", borderwidth=0,
            font=dict(size=fnt.body),
            traceorder="normal",
        ),
        showlegend=True,
        height=height, width=width,
        margin=dict(t=95, b=100, l=70, r=40),
        plot_bgcolor="white",
        paper_bgcolor="white",
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.write_image(str(out_path), scale=scale)
    return out_path


# ── Per-ticker DNA panel ───────────────────────────────────────────────────

def _add_dna_panel(fig: go.Figure, rows: list[dict[str, Any]], annotation_mode: str, *, col: int) -> None:
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
            text="Annualized σ of total return; segments = σ × variance share",
            font=dict(size=fnt.axis_label, color=pal.text_mid),
        ),
        tickfont=dict(size=fnt.axis_tick),
        row=1, col=col,
    )
    fig.update_yaxes(
        autorange="reversed",
        tickfont=dict(family=fnt.family, size=12, color=pal.navy),
        row=1, col=col,
    )
    _ = annotation_mode  # kept for backwards compat; right-rail labels removed


# ── Diversification panel ──────────────────────────────────────────────────

def _add_diversification_panel(fig: go.Figure, div: dict[str, Any], *, col: int) -> None:
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
                text=[f"{vals[0]:.0f}%" if vals[0] >= 4 else "",
                      f"{vals[1]:.0f}%" if vals[1] >= 4 else ""],
                textposition="inside",
                insidetextfont=dict(color="white", size=fnt.body),
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
            font=dict(family=fnt.family, size=fnt.body + 1, color=pal.navy),
        )

    # Credit callout sits below the right panel's x-tick labels, above the
    # figure-wide legend. Using domain references with a modest negative y so
    # it stays within paper bounds and doesn't collide with inside-bar labels.
    credit = div.get("diversification_credit", {})
    total_credit = credit.get("total")
    if total_credit is not None:
        try:
            credit_pct = float(total_credit) * 100
            fig.add_annotation(
                x=0.5, y=-0.16,
                text=(f"<span style='color:{pal.green}'>▼</span> "
                      f"<b>{credit_pct:.0f}% diversification credit</b>"),
                showarrow=False, xanchor="center", yanchor="top",
                xref=f"{_axis_ref('x', col)} domain",
                yref=f"{_axis_ref('y', col)} domain",
                font=dict(family=fnt.family, size=13, color=pal.navy),
            )
        except (TypeError, ValueError):
            pass

    y_top = max(naive_totals) * 1.18 if any(naive_totals) else 100
    fig.update_xaxes(
        tickfont=dict(family=fnt.family, size=11, color=pal.navy),
        row=1, col=col,
    )
    fig.update_yaxes(
        range=[0, y_top],
        ticksuffix="%",
        title=dict(text="Explained Risk",
                   font=dict(size=fnt.axis_label, color=pal.text_mid)),
        tickfont=dict(size=fnt.axis_tick),
        row=1, col=col,
    )


def _axis_ref(kind: str, col: int) -> str:
    return kind if col == 1 else f"{kind}{col}"
