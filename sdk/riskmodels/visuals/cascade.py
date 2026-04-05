"""Variable-width portfolio cascade plots (risk + attribution proxy)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, cast

import numpy as np
import pandas as pd

from ..lineage import RiskLineage
from . import styles
from .utils import (
    adjacent_bar_positions,
    build_title,
    cascade_plotly_layout,
    footnote_from_lineage,
    l3_er_tuple_from_row,
)

SortKey = Literal["weight", "risk_contribution"]


def _require_plotly() -> Any:
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
    return go


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


def plot_risk_cascade(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sort_by: SortKey = "weight",
    include_systematic_labels: bool = True,
    benchmark: Mapping[str, float] | None = None,
    style_preset: str = "risk_cascade",
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> Any:
    """Stacked L3 explained-risk shares; bar width ∝ portfolio weight (touching bars on unit axis)."""
    go = _require_plotly()
    _ = styles.get_preset(cast(Any, style_preset))
    if per_ticker.empty:
        from plotly.graph_objects import Figure

        return Figure()

    order = _sort_tickers(per_ticker, weights, sort_by=sort_by)
    w_arr = np.array([weights.get(t, 0.0) for t in order], dtype=float)
    centers, bar_widths = adjacent_bar_positions(w_arr, gap=0.0)

    mkt = np.array([l3_er_tuple_from_row(per_ticker.loc[t].to_dict())[0] for t in order])
    sec = np.array([l3_er_tuple_from_row(per_ticker.loc[t].to_dict())[1] for t in order])
    sub = np.array([l3_er_tuple_from_row(per_ticker.loc[t].to_dict())[2] for t in order])
    res = np.array([l3_er_tuple_from_row(per_ticker.loc[t].to_dict())[3] for t in order])

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
                text=[f"{v:.0%}" for v in vals] if include_systematic_labels else None,
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

    port_sys = float(
        sum(weights.get(t, 0.0) * (mkt[i] + sec[i] + sub[i]) for i, t in enumerate(order))
    )
    ann_text = f"Portfolio systematic (weighted ER): {port_sys:.0%}"

    meta = dict(metadata or {})
    if lineage:
        meta.setdefault("model_version", lineage.model_version)
    title = build_title("Portfolio L3 risk cascade", metadata=meta)
    foot = footnote_from_lineage(lineage)

    fig.update_layout(
        title=dict(text=title + (f"<br><sub>{foot}</sub>" if foot else "")),
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

    if benchmark:
        pass  # overlay hook — compare benchmark dict when API provides comparable series

    return fig


def plot_attribution_cascade(
    returns_long: pd.DataFrame,
    weights: Mapping[str, float],
    per_ticker_snapshot: pd.DataFrame,
    *,
    sort_by: SortKey = "weight",
    style_preset: str = "attribution_cascade",
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> Any:
    """Return contribution proxy (v1): weighted realized return × snapshot ER shares.

    Not Brinson attribution. See portfolio ``analyze_portfolio`` docs and release notes.
    """
    go = _require_plotly()
    _ = styles.get_preset(cast(Any, style_preset))
    if returns_long.empty or per_ticker_snapshot.empty:
        from plotly.graph_objects import Figure

        return Figure()

    col = "returns_gross" if "returns_gross" in returns_long.columns else (
        "gross_return" if "gross_return" in returns_long.columns else None
    )
    if col is None:
        from plotly.graph_objects import Figure

        return Figure()

    rlz = returns_long.groupby("ticker", sort=False)[col].apply(
        lambda s: float((1.0 + s.dropna().astype(float)).prod() - 1.0)
    )
    order = _sort_tickers(per_ticker_snapshot, weights, sort_by=sort_by)
    w_arr = np.array([weights.get(t, 0.0) for t in order], dtype=float)
    centers, bar_widths = adjacent_bar_positions(w_arr, gap=0.0)

    contribs = np.array([weights.get(t, 0.0) * float(rlz.get(t, 0.0)) for t in order])

    mkt = np.array([l3_er_tuple_from_row(per_ticker_snapshot.loc[t].to_dict())[0] for t in order])
    sec = np.array([l3_er_tuple_from_row(per_ticker_snapshot.loc[t].to_dict())[1] for t in order])
    sub = np.array([l3_er_tuple_from_row(per_ticker_snapshot.loc[t].to_dict())[2] for t in order])
    res = np.array([l3_er_tuple_from_row(per_ticker_snapshot.loc[t].to_dict())[3] for t in order])

    seg_m = contribs * mkt
    seg_s = contribs * sec
    seg_u = contribs * sub
    seg_r = contribs * res

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

    meta = dict(metadata or {})
    title = build_title("Portfolio attribution proxy (v1)", metadata=meta)
    foot = footnote_from_lineage(lineage)

    fig.update_layout(
        title=dict(
            text=title
            + "<br><sub>Proxy: weighted realized return × snapshot ER shares (not Brinson).</sub>"
            + (f"<br><sub>{foot}</sub>" if foot else "")
        ),
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
