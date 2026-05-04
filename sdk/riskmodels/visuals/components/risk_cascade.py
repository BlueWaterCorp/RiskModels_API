"""Risk cascade component: dataclass + builder + renderer.

Extracts the computation from ``visuals.cascade.plot_risk_cascade``
into a serializable dataclass, with a pure-render function.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from typing import Any, Literal

import numpy as np
import pandas as pd

from ...lineage import RiskLineage
from .. import styles
from ..utils import (
    adjacent_bar_positions,
    build_title,
    cascade_plotly_layout,
    footnote_from_lineage,
    l3_er_tuple_from_row,
)
from .._base import LineageSummary, RenderOptions, VisualComponentMixin
from ._types import CascadePosition, L3LayerValues

SortKey = Literal["weight", "risk_contribution"]


def _sort_tickers(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sort_by: SortKey,
) -> list[str]:
    tickers = [str(t).upper() for t in per_ticker.index]
    if sort_by == "weight":
        return sorted(tickers, key=lambda t: weights.get(t, 0.0), reverse=True)
    scores: dict[str, float] = {}
    for t in tickers:
        row = per_ticker.loc[t]
        m, s, u, _ = l3_er_tuple_from_row(row.to_dict())
        w = weights.get(t, 0.0)
        scores[t] = w * (m + s + u)
    return sorted(tickers, key=lambda t: scores.get(t, 0.0), reverse=True)


@dataclasses.dataclass
class RiskCascadeData(VisualComponentMixin):
    """Pre-computed data for a variable-width stacked L3 risk cascade."""

    positions: list[CascadePosition]
    sort_by: str
    portfolio_systematic_er: float
    title: str
    footnote: str
    include_systematic_labels: bool = True
    lineage: LineageSummary | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RiskCascadeData:
        lineage_d = d.get("lineage")
        return cls(
            positions=[CascadePosition.from_dict(p) for p in d["positions"]],
            sort_by=d["sort_by"],
            portfolio_systematic_er=float(d["portfolio_systematic_er"]),
            title=d["title"],
            footnote=d.get("footnote", ""),
            include_systematic_labels=d.get("include_systematic_labels", True),
            lineage=LineageSummary(**lineage_d) if lineage_d else None,
        )


def build_risk_cascade_data(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sort_by: SortKey = "weight",
    include_systematic_labels: bool = True,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> RiskCascadeData:
    """Build risk cascade data from per-ticker metrics and weights."""
    order = _sort_tickers(per_ticker, weights, sort_by=sort_by)

    positions: list[CascadePosition] = []
    for t in order:
        m, s, u, r = l3_er_tuple_from_row(per_ticker.loc[t].to_dict())
        positions.append(CascadePosition(
            ticker=t,
            weight=weights.get(t, 0.0),
            l3=L3LayerValues(market=m, sector=s, subsector=u, residual=r),
        ))

    port_sys = sum(p.weight * p.l3.systematic for p in positions)

    meta = dict(metadata or {})
    if lineage:
        meta.setdefault("model_version", lineage.model_version)
    title = build_title("Portfolio L3 risk cascade", metadata=meta)
    foot = footnote_from_lineage(lineage)

    return RiskCascadeData(
        positions=positions,
        sort_by=sort_by,
        portfolio_systematic_er=port_sys,
        title=title,
        footnote=foot,
        include_systematic_labels=include_systematic_labels,
        lineage=LineageSummary.from_risk_lineage(lineage),
    )


def plot_risk_cascade_from_data(
    data: RiskCascadeData,
    *,
    render_options: RenderOptions | None = None,
) -> Any:
    """Pure render: build a Plotly figure from pre-computed risk cascade data."""
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires Plotly — run: pip install -U riskmodels-py") from e

    if not data.positions:
        return go.Figure()

    order = [p.ticker for p in data.positions]
    w_arr = np.array([p.weight for p in data.positions], dtype=float)
    centers, bar_widths = adjacent_bar_positions(w_arr, gap=0.0)

    mkt = np.array([p.l3.market for p in data.positions])
    sec = np.array([p.l3.sector for p in data.positions])
    sub = np.array([p.l3.subsector for p in data.positions])
    res = np.array([p.l3.residual for p in data.positions])

    colors = styles.L3_LAYER_COLORS
    fig = go.Figure()
    base = np.zeros(len(order))

    def add_layer(name: str, vals: np.ndarray, color: str) -> None:
        nonlocal base
        fig.add_trace(
            go.Bar(
                x=centers,
                y=vals,
                width=bar_widths,
                base=base,
                name=name,
                marker=dict(color=color, line=dict(width=0)),
                text=[f"{v:.0%}" for v in vals] if data.include_systematic_labels else None,
                textposition="inside",
                hovertemplate="%{customdata[0]}<br>" + name + ": %{y:.3f}<extra></extra>",
                customdata=[[t] for t in order],
            )
        )
        base = base + vals

    add_layer("L3 market", mkt, colors["market"])
    add_layer("L3 sector", sec, colors["sector"])
    add_layer("L3 subsector", sub, colors["subsector"])
    add_layer("L3 residual", res, colors["residual"])

    ann_text = f"Portfolio systematic (weighted ER): {data.portfolio_systematic_er:.0%}"
    title_text = data.title + (f"<br><sub>{data.footnote}</sub>" if data.footnote else "")

    fig.update_layout(
        title=dict(text=title_text),
        xaxis=dict(
            title="Position (width ∝ weight; adjacent, no gaps)",
            range=[0.0, 1.0],
            showgrid=True,
            tickmode="array",
            tickvals=list(centers),
            ticktext=order,
            zeroline=False,
        ),
        yaxis=dict(title="Explained variance share (stacked to 100%)", range=[0, 1.05], tickformat=".0%"),
        **cascade_plotly_layout(),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        annotations=[
            dict(text=ann_text, showarrow=False, xref="paper", yref="paper", x=0, y=-0.12)
        ],
        template="plotly_white",
        height=480,
    )

    return fig
