"""Horizontal waterfall chart showing step-by-step variance decomposition.

Shows how total portfolio variance is built from:
Market -> Sector -> Subsector -> Residual = Total

Each bar starts where the previous one ended (classic waterfall), making it
visually clear how much each factor layer contributes to total risk.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
import pandas as pd

from ..lineage import RiskLineage
from . import styles
from .utils import build_title, footnote_from_lineage, l3_er_tuple_from_row

_SIGMA = "\u03c3"  # Greek sigma — defined once, used consistently


def _require_plotly() -> Any:
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
    return go


def plot_variance_waterfall(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sigma_scaled: bool = True,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> Any:
    """Portfolio-level L3 variance waterfall.

    Parameters
    ----------
    per_ticker : pd.DataFrame
        Per-ticker metrics (index = ticker), as from ``PortfolioAnalysis.per_ticker``.
    weights : Mapping[str, float]
        Portfolio weights (should sum to ~1).
    sigma_scaled : bool
        If True, segments are sigma x ER share (annualized vol contribution).
        If False, segments are pure variance fractions (sum to 1).
    metadata : Mapping | None
        Optional metadata dict for title subtitle (``teo``, ``model_version``).
    lineage : RiskLineage | None
        Data lineage for footnote.
    """
    go = _require_plotly()
    if per_ticker.empty:
        return go.Figure()

    # Compute portfolio-level weighted ER shares
    tickers = [str(t) for t in per_ticker.index if t in weights]
    total_mkt = total_sec = total_sub = total_res = 0.0
    total_vol = 0.0

    for t in tickers:
        row = per_ticker.loc[t]
        w = weights.get(t, 0.0)
        m, s, u, r = l3_er_tuple_from_row(row.to_dict())
        total_mkt += w * m
        total_sec += w * s
        total_sub += w * u
        total_res += w * r

        # For sigma-scaling: weighted average vol
        vol = row.get("vol_23d") or row.get("volatility")
        if vol is not None:
            try:
                v = float(vol)
                if 1.0 < v <= 150.0:
                    v /= 100.0
                total_vol += w * v
            except (TypeError, ValueError):
                pass

    colors = styles.L3_LAYER_COLORS

    if sigma_scaled and total_vol > 0:
        layers = [
            ("Market", total_mkt * total_vol, colors["market"]),
            ("Sector", total_sec * total_vol, colors["sector"]),
            ("Subsector", total_sub * total_vol, colors["subsector"]),
            ("Residual", total_res * total_vol, colors["residual"]),
        ]
        total = total_vol
        val_fmt = lambda v: f"{v * 100:.1f}%"  # noqa: E731
        x_title = f"Annualized volatility contribution (ann. {_SIGMA})"
        x_fmt = ".1%"
        total_label = "Total ann. vol"
        systematic_vol = (total_mkt + total_sec + total_sub) * total_vol
        sys_label = (
            f"Systematic: {systematic_vol * 100:.1f}% "
            f"of {total_vol * 100:.1f}% portfolio ann. {_SIGMA}"
        )
    else:
        layers = [
            ("Market", total_mkt, colors["market"]),
            ("Sector", total_sec, colors["sector"]),
            ("Subsector", total_sub, colors["subsector"]),
            ("Residual", total_res, colors["residual"]),
        ]
        total = sum(v for _, v, _ in layers)
        val_fmt = lambda v: f"{v:.1%}"  # noqa: E731
        x_title = "Explained variance share"
        x_fmt = ".0%"
        total_label = "Total variance"
        systematic = total_mkt + total_sec + total_sub
        sys_label = f"Systematic: {systematic:.0%} of explained variance"

    categories = [name for name, _, _ in layers] + [total_label]
    values = [v for _, v, _ in layers]
    bar_colors = [c for _, _, c in layers] + ["#1e293b"]

    # Waterfall: each step bar starts where the previous ended
    bases: list[float] = [0.0]
    for v in values[:-1]:
        bases.append(bases[-1] + v)
    # Total bar starts at zero (spans full width)
    bases.append(0.0)
    values.append(total)

    fig = go.Figure()

    for i, (cat, val, base, color) in enumerate(
        zip(categories, values, bases, bar_colors)
    ):
        is_total = i == len(categories) - 1
        label = val_fmt(val)
        # Only show inside label if bar is wide enough (>5% of total)
        show_inside = val / total > 0.05 if total > 0 else True
        fig.add_trace(
            go.Bar(
                y=[cat],
                x=[val],
                base=[base],
                orientation="h",
                name=cat,
                marker=dict(
                    color=color,
                    line=dict(width=1.5, color="white"),
                    opacity=1.0,
                ),
                text=[label] if show_inside else [""],
                textposition="inside",
                textfont=dict(
                    color="white",
                    size=11,
                    family="Arial, Helvetica, sans-serif",
                ),
                showlegend=not is_total,
                hovertemplate=f"<b>{cat}</b><br>{label}<extra></extra>",
            )
        )

    # Connector lines between step bars (use paper-fraction y coords via shapes)
    # Categories are 0-indexed in the reversed yaxis. With autorange="reversed",
    # category 0 = top. Plotly shape y coords with yref="y" use the category name.
    n_steps = len(categories) - 1  # exclude Total bar
    for i in range(n_steps - 1):
        edge_x = bases[i] + values[i]
        # Connect bottom of current bar to top of next bar
        fig.add_shape(
            type="line",
            xref="x",
            yref="paper",
            x0=edge_x,
            x1=edge_x,
            # paper coords: top=0, bottom=1 for reversed axis
            # step bars occupy i/(n_steps) to (i+1)/(n_steps) of paper height
            y0=(i + 0.48) / n_steps,
            y1=(i + 0.52) / n_steps,
            line=dict(color="#64748b", width=1.5, dash="dot"),
        )

    meta = dict(metadata or {})
    if lineage:
        meta.setdefault("model_version", lineage.model_version)
    subtitle = (
        f"{_SIGMA}-scaled — bar length = portfolio ann. {_SIGMA} x ER share"
        if sigma_scaled
        else "Variance fractions — bars sum to 100%"
    )
    title = build_title("Portfolio variance decomposition", subtitle=subtitle, metadata=meta)
    foot = footnote_from_lineage(lineage)

    fig.update_layout(
        title=dict(
            text=title + (f"<br><sup>{foot}</sup>" if foot else ""),
            font=dict(size=14, color=styles.TITLE_DEEP, family="Arial, Helvetica, sans-serif"),
            x=0,
            xanchor="left",
        ),
        xaxis=dict(
            title=dict(text=x_title, font=dict(size=11, color=styles.TITLE_SLATE)),
            tickformat=x_fmt,
            tickfont=dict(size=10),
            zeroline=True,
            zerolinecolor="#cbd5e1",
            gridcolor="#e2e8f0",
            gridwidth=1,
            range=[0, total * 1.15],
            showline=True,
            linecolor="#cbd5e1",
        ),
        yaxis=dict(
            autorange="reversed",
            categoryorder="array",
            categoryarray=categories,
            tickfont=dict(size=12, color=styles.TITLE_DEEP, family="Arial, Helvetica, sans-serif"),
            showgrid=False,
            showline=True,
            linecolor="#cbd5e1",
        ),
        annotations=[
            dict(
                text=sys_label,
                showarrow=False,
                xref="paper",
                yref="paper",
                x=0.0,
                y=-0.18,
                xanchor="left",
                font=dict(size=10, color=styles.TITLE_SLATE, family="Arial, Helvetica, sans-serif"),
            ),
        ],
        template="plotly_white",
        paper_bgcolor="white",
        plot_bgcolor="#fafbfc",
        height=360,
        margin=dict(l=120, r=40, t=90, b=70),
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.04,
            xanchor="right",
            x=1,
            font=dict(size=11),
            bgcolor="rgba(255,255,255,0)",
        ),
        bargap=0.35,
    )

    return fig
