"""Attribution cascade component: dataclass + builder + renderer.

Extracts the computation from ``visuals.cascade.plot_attribution_cascade``
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
from ._types import AttributionPosition, L3LayerValues

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
class AttributionCascadeData(VisualComponentMixin):
    """Pre-computed data for a return contribution proxy cascade."""

    positions: list[AttributionPosition]
    sort_by: str
    title: str
    footnote: str
    lineage: LineageSummary | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> AttributionCascadeData:
        lineage_d = d.get("lineage")
        return cls(
            positions=[AttributionPosition.from_dict(p) for p in d["positions"]],
            sort_by=d["sort_by"],
            title=d["title"],
            footnote=d.get("footnote", ""),
            lineage=LineageSummary(**lineage_d) if lineage_d else None,
        )


def build_attribution_cascade_data(
    returns_long: pd.DataFrame,
    weights: Mapping[str, float],
    per_ticker_snapshot: pd.DataFrame,
    *,
    sort_by: SortKey = "weight",
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> AttributionCascadeData:
    """Build attribution cascade data from returns, weights, and snapshot metrics."""
    col = "returns_gross" if "returns_gross" in returns_long.columns else (
        "gross_return" if "gross_return" in returns_long.columns else None
    )

    # Compute cumulative realized returns per ticker
    if col is not None and not returns_long.empty:
        rlz = returns_long.groupby("ticker", sort=False)[col].apply(
            lambda s: float((1.0 + s.dropna().astype(float)).prod() - 1.0)
        )
    else:
        rlz = pd.Series(dtype=float)

    order = _sort_tickers(per_ticker_snapshot, weights, sort_by=sort_by)

    positions: list[AttributionPosition] = []
    for t in order:
        m, s, u, r = l3_er_tuple_from_row(per_ticker_snapshot.loc[t].to_dict())
        positions.append(AttributionPosition(
            ticker=t,
            weight=weights.get(t, 0.0),
            realized_return=float(rlz.get(t, 0.0)),
            l3=L3LayerValues(market=m, sector=s, subsector=u, residual=r),
        ))

    meta = dict(metadata or {})
    title = build_title("Portfolio attribution proxy (v1)", metadata=meta)
    foot = footnote_from_lineage(lineage)

    return AttributionCascadeData(
        positions=positions,
        sort_by=sort_by,
        title=title,
        footnote=foot,
        lineage=LineageSummary.from_risk_lineage(lineage),
    )


def plot_attribution_cascade_from_data(
    data: AttributionCascadeData,
    *,
    render_options: RenderOptions | None = None,
) -> Any:
    """Pure render: build a Plotly figure from pre-computed attribution cascade data."""
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires Plotly — run: pip install -U riskmodels-py") from e

    if not data.positions:
        return go.Figure()

    order = [p.ticker for p in data.positions]
    w_arr = np.array([p.weight for p in data.positions], dtype=float)
    centers, bar_widths = adjacent_bar_positions(w_arr, gap=0.0)

    # Contribution = weight * realized_return; split by L3 ER shares
    contribs = np.array([p.weight * p.realized_return for p in data.positions])
    seg_m = contribs * np.array([p.l3.market for p in data.positions])
    seg_s = contribs * np.array([p.l3.sector for p in data.positions])
    seg_u = contribs * np.array([p.l3.subsector for p in data.positions])
    seg_r = contribs * np.array([p.l3.residual for p in data.positions])

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
                hovertemplate="%{customdata[0]}<br>" + name + ": %{y:.4f}<extra></extra>",
                customdata=[[t] for t in order],
            )
        )
        base = base + vals

    add_layer("Market sleeve (proxy)", seg_m, colors["market"])
    add_layer("Sector sleeve (proxy)", seg_s, colors["sector"])
    add_layer("Subsector sleeve (proxy)", seg_u, colors["subsector"])
    add_layer("Residual sleeve (proxy)", seg_r, colors["residual"])

    title_text = (
        data.title
        + "<br><sub>Proxy: weighted realized return × snapshot ER shares (not Brinson).</sub>"
        + (f"<br><sub>{data.footnote}</sub>" if data.footnote else "")
    )

    fig.update_layout(
        title=dict(text=title_text),
        xaxis=dict(
            title="Position (width ∝ weight; adjacent, no gaps)",
            range=[0.0, 1.0],
            tickmode="array",
            tickvals=list(centers),
            ticktext=order,
            zeroline=False,
        ),
        yaxis=dict(title="Return contribution (proxy)"),
        **cascade_plotly_layout(),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        template="plotly_white",
        height=480,
    )
    return fig
