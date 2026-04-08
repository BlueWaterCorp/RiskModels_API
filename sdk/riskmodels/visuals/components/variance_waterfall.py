"""Variance waterfall component: dataclass + builder + renderer.

Extracts the computation from ``visuals.waterfall.plot_variance_waterfall``
into a serializable dataclass, with a pure-render function that takes only data.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from typing import Any

import pandas as pd

from ...lineage import RiskLineage
from .. import styles
from ..utils import build_title, footnote_from_lineage, l3_er_tuple_from_row
from .._base import LineageSummary, RenderOptions, VisualComponentMixin
from ._types import WaterfallLayer

_SIGMA = "\u03c3"


@dataclasses.dataclass
class VarianceWaterfallData(VisualComponentMixin):
    """Pre-computed data for a portfolio-level L3 variance waterfall chart."""

    layers: list[WaterfallLayer]
    total_value: float
    sigma_scaled: bool
    x_title: str
    systematic_annotation: str
    title: str
    footnote: str
    lineage: LineageSummary | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> VarianceWaterfallData:
        sv = d.get("schema_version", "1.0")
        lineage_d = d.get("lineage")
        return cls(
            layers=[WaterfallLayer.from_dict(l) for l in d["layers"]],
            total_value=float(d["total_value"]),
            sigma_scaled=bool(d["sigma_scaled"]),
            x_title=d["x_title"],
            systematic_annotation=d["systematic_annotation"],
            title=d["title"],
            footnote=d.get("footnote", ""),
            lineage=LineageSummary(**lineage_d) if lineage_d else None,
        )


def build_variance_waterfall_data(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sigma_scaled: bool = True,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> VarianceWaterfallData:
    """Build waterfall data from per-ticker metrics and portfolio weights.

    This is the computation half — all weighted averages, sigma scaling,
    and text formatting happen here. The renderer only lays out bars.
    """
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
            WaterfallLayer("Market", total_mkt * total_vol, colors["market"]),
            WaterfallLayer("Sector", total_sec * total_vol, colors["sector"]),
            WaterfallLayer("Subsector", total_sub * total_vol, colors["subsector"]),
            WaterfallLayer("Residual", total_res * total_vol, colors["residual"]),
        ]
        total = total_vol
        x_title = f"Annualized volatility contribution (ann. {_SIGMA})"
        systematic_vol = (total_mkt + total_sec + total_sub) * total_vol
        sys_ann = (
            f"Systematic: {systematic_vol * 100:.1f}% "
            f"of {total_vol * 100:.1f}% portfolio ann. {_SIGMA}"
        )
    else:
        layers = [
            WaterfallLayer("Market", total_mkt, colors["market"]),
            WaterfallLayer("Sector", total_sec, colors["sector"]),
            WaterfallLayer("Subsector", total_sub, colors["subsector"]),
            WaterfallLayer("Residual", total_res, colors["residual"]),
        ]
        total = sum(l.value for l in layers)
        x_title = "Explained variance share"
        systematic = total_mkt + total_sec + total_sub
        sys_ann = f"Systematic: {systematic:.0%} of explained variance"

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

    return VarianceWaterfallData(
        layers=layers,
        total_value=total,
        sigma_scaled=sigma_scaled,
        x_title=x_title,
        systematic_annotation=sys_ann,
        title=title,
        footnote=foot,
        lineage=LineageSummary.from_risk_lineage(lineage),
    )


def plot_variance_waterfall_from_data(
    data: VarianceWaterfallData,
    *,
    render_options: RenderOptions | None = None,
) -> Any:
    """Pure render: build a Plotly figure from pre-computed waterfall data.

    No computation, no API calls — only Plotly trace assembly.
    """
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e

    if not data.layers:
        return go.Figure()

    total = data.total_value
    val_fmt = (
        (lambda v: f"{v * 100:.1f}%") if data.sigma_scaled
        else (lambda v: f"{v:.1%}")
    )
    x_fmt = ".1%" if data.sigma_scaled else ".0%"
    total_label = "Total ann. vol" if data.sigma_scaled else "Total variance"

    categories = [l.label for l in data.layers] + [total_label]
    values = [l.value for l in data.layers]
    bar_colors = [l.color for l in data.layers] + ["#1e293b"]

    # Waterfall: each step bar starts where the previous ended
    bases: list[float] = [0.0]
    for v in values[:-1]:
        bases.append(bases[-1] + v)
    bases.append(0.0)
    values.append(total)

    fig = go.Figure()

    for i, (cat, val, base, color) in enumerate(
        zip(categories, values, bases, bar_colors)
    ):
        is_total = i == len(categories) - 1
        label = val_fmt(val)
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

    # Connector lines between step bars
    n_steps = len(categories) - 1
    for i in range(n_steps - 1):
        edge_x = bases[i] + values[i]
        fig.add_shape(
            type="line",
            xref="x",
            yref="paper",
            x0=edge_x,
            x1=edge_x,
            y0=(i + 0.48) / n_steps,
            y1=(i + 0.52) / n_steps,
            line=dict(color="#64748b", width=1.5, dash="dot"),
        )

    title_text = data.title + (f"<br><sup>{data.footnote}</sup>" if data.footnote else "")

    fig.update_layout(
        title=dict(
            text=title_text,
            font=dict(size=14, color=styles.TITLE_DEEP, family="Arial, Helvetica, sans-serif"),
            x=0,
            xanchor="left",
        ),
        xaxis=dict(
            title=dict(text=data.x_title, font=dict(size=11, color=styles.TITLE_SLATE)),
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
                text=data.systematic_annotation,
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
