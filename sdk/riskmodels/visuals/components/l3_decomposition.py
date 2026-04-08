"""L3 decomposition component: dataclass + builder + renderer.

Extracts the input processing from ``visuals.l3_decomposition.plot_l3_horizontal``
into a serializable dataclass, with the full Plotly rendering preserved.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping
from typing import Any, Literal

import numpy as np
import pandas as pd

from ...lineage import RiskLineage
from .. import styles
from ..utils import (
    annualized_vol_decimal,
    build_title,
    footnote_from_lineage,
    format_l3_annotation_er_systematic,
    format_l3_annotation_rr_hr,
    l3_er_tuple_from_row,
    l3_rr_tuple_from_row,
    sigma_array_from_rows,
)
from .._base import LineageSummary, RenderOptions, VisualComponentMixin
from ._types import L3LayerValues, L3TickerRow

AnnotationMode = Literal["er_systematic", "rr_hr"]
PlotlyTheme = Literal["light", "terminal_dark"]


@dataclasses.dataclass
class L3DecompositionData(VisualComponentMixin):
    """Pre-computed data for horizontal stacked L3 decomposition bars."""

    rows: list[L3TickerRow]
    sigma_scaled: bool
    annotation_mode: str
    title: str
    subtitle: str | None = None
    footnote: str = ""
    universe_avg_vol: float | None = None
    lineage: LineageSummary | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> L3DecompositionData:
        lineage_d = d.get("lineage")
        return cls(
            rows=[L3TickerRow.from_dict(r) for r in d["rows"]],
            sigma_scaled=bool(d["sigma_scaled"]),
            annotation_mode=d["annotation_mode"],
            title=d["title"],
            subtitle=d.get("subtitle"),
            footnote=d.get("footnote", ""),
            universe_avg_vol=d.get("universe_avg_vol"),
            lineage=LineageSummary(**lineage_d) if lineage_d else None,
        )


def build_l3_decomposition_data(
    rows: list[dict[str, Any]] | pd.DataFrame,
    *,
    sigma_scaled: bool = True,
    annotation_mode: AnnotationMode = "rr_hr",
    title: str | None = None,
    subtitle: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
    tuple_from_row: Callable[[Mapping[str, Any]], tuple[float, float, float, float]] | None = None,
    universe_avg_vol: float | None = None,
) -> L3DecompositionData:
    """Build L3 decomposition data from row dicts or DataFrame."""
    if isinstance(rows, pd.DataFrame):
        recs = rows.to_dict("records")
    else:
        recs = list(rows)

    tfn = tuple_from_row or (l3_rr_tuple_from_row if annotation_mode == "rr_hr" else l3_er_tuple_from_row)

    ticker_rows: list[L3TickerRow] = []
    for i, r in enumerate(recs):
        rd = dict(r)
        ticker = str(rd.get("ticker", f"Row{i}"))
        m, s, u, res = tfn(rd)
        vol = annualized_vol_decimal(rd)
        ticker_rows.append(L3TickerRow(
            ticker=ticker,
            l3=L3LayerValues(market=m, sector=s, subsector=u, residual=res),
            annualized_vol=vol,
            subsector_etf=str(rd.get("subsector_etf") or rd.get("subsector_etf_symbol") or "").strip() or None,
            sector_etf=str(rd.get("sector_etf") or "").strip() or None,
        ))

    meta = dict(metadata or {})
    if lineage:
        meta.setdefault("model_version", lineage.model_version)
        meta.setdefault("data_as_of", lineage.data_as_of)

    head = title or ("L3 risk DNA (σ-scaled, RR + HR)" if sigma_scaled else "L3 explained risk")
    full_title = build_title(head, metadata=meta, subtitle=subtitle)
    foot = footnote_from_lineage(lineage)

    return L3DecompositionData(
        rows=ticker_rows,
        sigma_scaled=sigma_scaled,
        annotation_mode=annotation_mode,
        title=full_title,
        subtitle=subtitle,
        footnote=foot,
        universe_avg_vol=universe_avg_vol,
        lineage=LineageSummary.from_risk_lineage(lineage),
    )


def plot_l3_decomposition_from_data(
    data: L3DecompositionData,
    *,
    render_options: RenderOptions | None = None,
    annotation_formatter: Callable[[int, dict[str, Any]], str] | None = None,
) -> Any:
    """Pure render: build a Plotly figure from pre-computed L3 decomposition data.

    The ``annotation_formatter`` is an optional callback for custom right-rail text.
    It cannot be serialized, so it's a render-time parameter only.
    """
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e

    n = len(data.rows)
    if n == 0:
        return go.Figure()

    theme: PlotlyTheme = "light"
    if render_options and render_options.theme in ("light", "terminal_dark"):
        theme = render_options.theme  # type: ignore[assignment]

    tickers = [r.ticker for r in data.rows]

    mkt = np.array([r.l3.market for r in data.rows], dtype=float)
    sec = np.array([r.l3.sector for r in data.rows], dtype=float)
    sub = np.array([r.l3.subsector for r in data.rows], dtype=float)
    res = np.array([r.l3.residual for r in data.rows], dtype=float)

    if data.sigma_scaled:
        sigma = np.array([r.annualized_vol or 0.3 for r in data.rows], dtype=float)
        mkt_v, sec_v, sub_v, res_v = mkt * sigma, sec * sigma, sub * sigma, res * sigma
        totals = mkt_v + sec_v + sub_v + res_v
        data_max = float(np.nanmax(totals)) if n else 0.35
        if not np.isfinite(data_max):
            data_max = 0.35
        padded = max(float(data_max) * 1.08, 1e-9)
        xmax = float(np.ceil(padded * 20.0) / 20.0)
        xmax = max(xmax, 0.05)
        xmax = min(xmax, 2.0)
        sigma_x_dtick = 0.05 if xmax <= 0.45 else 0.1
        if data.annotation_mode == "rr_hr":
            x_title = (
                "Annualized σ of total return; segments = σ × "
                "(L3 market/sector/subsector RR + HR residual)"
            )
        else:
            x_title = "Annualized σ × variance share (total length ∝ σ)"
    else:
        mkt_v, sec_v, sub_v, res_v = mkt, sec, sub, res
        x_title = (
            "Fraction of return variance (explained risk)"
            if data.annotation_mode == "er_systematic"
            else "Fraction of variance (explained risk)"
        )
        xmax = 1.0
        sigma_x_dtick = 0.2  # default for non-sigma

    if data.annotation_mode == "er_systematic":
        seg_names = ("Market", "Sector", "Subsector", "Idiosyncratic")
    else:
        seg_names = ("L3 market RR", "L3 sector RR", "L3 subsector RR", "HR")

    colors = styles.L3_LAYER_COLORS
    fig = go.Figure()

    def add_seg(name: str, vals: np.ndarray, left: np.ndarray, color: str, show_legend: bool) -> np.ndarray:
        fig.add_trace(
            go.Bar(
                y=tickers,
                x=vals,
                base=left,
                orientation="h",
                name=name,
                marker=dict(color=color, line=dict(width=0, color=color)),
                showlegend=show_legend,
                hovertemplate="%{x:.4f}<extra>" + name + "</extra>",
            )
        )
        return left + vals

    left = np.zeros(n, dtype=float)
    left = add_seg(seg_names[0], mkt_v, left, colors["market"], True)
    left = add_seg(seg_names[1], sec_v, left, colors["sector"], True)
    left = add_seg(seg_names[2], sub_v, left, colors["subsector"], True)
    add_seg(seg_names[3], res_v, left, colors["residual"], True)

    # Right-rail annotations
    ann_font = dict(styles.ANNOTATION_FONT)
    _is_er_var = (not data.sigma_scaled) and data.annotation_mode == "er_systematic"
    _is_sigma_rr = data.sigma_scaled and data.annotation_mode == "rr_hr"

    if _is_er_var:
        ann_font = {
            **ann_font,
            "family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }
    if theme == "terminal_dark":
        ann_font = {**ann_font, "color": styles.TERMINAL_MUTED}

    annotations: list[dict[str, Any]] = []
    for i, row in enumerate(data.rows):
        if annotation_formatter is not None:
            rd = {
                "ticker": row.ticker,
                "subsector_etf": row.subsector_etf,
                "sector_etf": row.sector_etf,
                "vol_23d": row.annualized_vol,
                "l3_market_rr": row.l3.market,
                "l3_sector_rr": row.l3.sector,
                "l3_subsector_rr": row.l3.subsector,
                "l3_residual_er": row.l3.residual,
                "l3_market_er": row.l3.market,
                "l3_sector_er": row.l3.sector,
                "l3_subsector_er": row.l3.subsector,
            }
            txt = annotation_formatter(i, rd)
        elif data.annotation_mode == "rr_hr":
            rd = {
                "subsector_etf": row.subsector_etf,
                "sector_etf": row.sector_etf,
                "vol_23d": row.annualized_vol,
                "l3_market_rr": row.l3.market,
                "l3_sector_rr": row.l3.sector,
                "l3_subsector_rr": row.l3.subsector,
                "l3_residual_er": row.l3.residual,
            }
            txt = format_l3_annotation_rr_hr(rd)
        else:
            rd = {
                "subsector_etf": row.subsector_etf,
                "sector_etf": row.sector_etf,
                "l3_market_er": row.l3.market,
                "l3_sector_er": row.l3.sector,
                "l3_subsector_er": row.l3.subsector,
                "l3_residual_er": row.l3.residual,
            }
            txt = format_l3_annotation_er_systematic(rd)

        if not data.sigma_scaled:
            ann_xref = "paper"
            ann_x = 1.02
        else:
            ann_xref = "x"
            ann_x = xmax * 1.015
        annotations.append(
            dict(
                x=ann_x,
                xref=ann_xref,
                y=tickers[i],
                yref="y",
                text=txt,
                showarrow=False,
                xanchor="left",
                font=ann_font,
            )
        )

    # Theme-specific layout
    if theme == "terminal_dark":
        xaxis_kw: dict[str, Any] = dict(
            title=dict(text=x_title, font=dict(size=12, color=styles.TERMINAL_MUTED)),
            showgrid=True,
            gridcolor="rgba(74, 76, 102, 0.75)",
            gridwidth=1,
            showline=True,
            linecolor=styles.TERMINAL_BORDER,
            linewidth=1.1,
            zeroline=False,
            tickfont=dict(color=styles.TERMINAL_MUTED, size=10),
        )
        if not data.sigma_scaled:
            xaxis_kw["range"] = [0.0, 1.0]
            xaxis_kw["tickformat"] = ".0%"
            xaxis_kw["tickmode"] = "linear"
            xaxis_kw["dtick"] = 0.2
        else:
            xaxis_kw["range"] = [0.0, xmax]
            xaxis_kw["tickformat"] = ".0%"
            xaxis_kw["tickmode"] = "linear"
            xaxis_kw["dtick"] = sigma_x_dtick
            if _is_sigma_rr:
                xaxis_kw["griddash"] = "dash"

        yaxis_kw: dict[str, Any] = dict(
            categoryorder="array",
            categoryarray=tickers[::-1],
            tickfont=dict(size=12, color=styles.TERMINAL_FG, family="Arial, Helvetica, sans-serif"),
            showgrid=False,
            showline=True,
            linecolor=styles.TERMINAL_BORDER,
            linewidth=1,
            mirror=False,
            zeroline=False,
        )

        title_font = dict(size=16, color=styles.TERMINAL_FG, family="Arial, Helvetica, sans-serif")
        legend_kw = dict(
            orientation="h",
            yanchor="top",
            y=-0.14,
            x=0.5,
            xanchor="center",
            bgcolor=styles.TERMINAL_CARD,
            bordercolor=styles.TERMINAL_BORDER,
            borderwidth=1,
            font=dict(size=11, color=styles.TERMINAL_FG),
        )
        paper_bg = styles.TERMINAL_BG
        plot_bg = styles.TERMINAL_BG
        font_kw = dict(family="Arial, Helvetica, sans-serif", color=styles.TERMINAL_MUTED)
        tmpl = "plotly_dark"
    else:
        xaxis_kw = dict(
            title=dict(text=x_title, font=dict(size=12, color=styles.TITLE_SLATE)),
            showgrid=True,
            gridcolor="rgba(148, 163, 184, 0.35)",
            gridwidth=1,
            zeroline=False,
        )
        if not data.sigma_scaled:
            xaxis_kw["range"] = [0.0, 1.0]
            xaxis_kw["tickformat"] = ".0%"
            xaxis_kw["tickmode"] = "linear"
            xaxis_kw["dtick"] = 0.2
        else:
            xaxis_kw["range"] = [0.0, xmax]
            xaxis_kw["tickformat"] = ".0%"
            xaxis_kw["tickmode"] = "linear"
            xaxis_kw["dtick"] = sigma_x_dtick
            if _is_sigma_rr:
                xaxis_kw["griddash"] = "dash"

        yaxis_kw = dict(
            categoryorder="array",
            categoryarray=tickers[::-1],
            tickfont=dict(size=12, color=styles.TITLE_DEEP),
            showgrid=True,
            gridcolor="rgba(241, 245, 249, 0.95)",
            gridwidth=1,
            zeroline=False,
        )
        if _is_er_var:
            yaxis_kw["tickfont"] = dict(size=12, color=styles.TITLE_DEEP, family="Arial, Helvetica, sans-serif")

        title_font = dict(size=16, color=styles.TITLE_DEEP, family="Arial, Helvetica, sans-serif")
        legend_kw = dict(
            orientation="h",
            yanchor="top",
            y=-0.14,
            x=0.5,
            xanchor="center",
            bgcolor="rgba(255,255,255,0.92)",
            bordercolor="#e2e8f0",
            borderwidth=1,
            font=dict(size=11),
        )
        paper_bg = "white"
        plot_bg = "#fafbfc"
        font_kw = dict(family="Arial, Helvetica, sans-serif", color=styles.TITLE_SLATE)
        tmpl = "plotly_white"

    if _is_er_var or _is_sigma_rr:
        layout_height = max(560, 102 * n + 210)
        layout_bargap = 0.34
        margin_kw = dict(l=96, r=272, t=96, b=132)
    else:
        layout_height = max(400, 76 * n)
        layout_bargap = 0
        margin_kw = dict(l=88, r=260, t=88, b=120)

    if _is_er_var and theme == "light":
        xaxis_kw["showline"] = True
        xaxis_kw["linecolor"] = "#cbd5e1"
        xaxis_kw["linewidth"] = 1
        xaxis_kw["mirror"] = False
        xaxis_kw["gridcolor"] = "rgba(148, 163, 184, 0.48)"
        yaxis_kw["showgrid"] = False
        yaxis_kw["showline"] = True
        yaxis_kw["linecolor"] = styles.TITLE_DEEP
        yaxis_kw["linewidth"] = 1
        yaxis_kw["mirror"] = False

    if _is_sigma_rr and theme == "light":
        xaxis_kw["showline"] = True
        xaxis_kw["linecolor"] = "#cbd5e1"
        xaxis_kw["linewidth"] = 1
        xaxis_kw["mirror"] = False
        xaxis_kw["gridcolor"] = "rgba(148, 163, 184, 0.42)"
        yaxis_kw["showgrid"] = False
        yaxis_kw["showline"] = True
        yaxis_kw["linecolor"] = styles.TITLE_DEEP
        yaxis_kw["linewidth"] = 1
        yaxis_kw["mirror"] = False

    if _is_sigma_rr and theme == "terminal_dark":
        yaxis_kw["showgrid"] = False

    # Optional universe average vol reference line
    if data.sigma_scaled and data.universe_avg_vol is not None and data.universe_avg_vol > 0:
        ref_color = "#64748b" if theme == "light" else styles.TERMINAL_MUTED
        fig.add_shape(
            type="line",
            xref="x",
            yref="paper",
            x0=data.universe_avg_vol,
            x1=data.universe_avg_vol,
            y0=0.0,
            y1=1.0,
            line=dict(color=ref_color, width=1.5, dash="dash"),
        )
        annotations.append(
            dict(
                x=data.universe_avg_vol,
                y=1.01,
                xref="x",
                yref="paper",
                text=f"Universe avg \u03c3: {data.universe_avg_vol:.0%}",
                showarrow=False,
                font=dict(size=10, color=ref_color, family="Arial, Helvetica, sans-serif"),
                xanchor="center",
                yanchor="bottom",
            )
        )

    foot = data.footnote
    if foot and theme == "terminal_dark":
        foot_block = f'<br><sub style="color:{styles.TERMINAL_MUTED}">{foot}</sub>'
    elif foot:
        foot_block = f"<br><sub>{foot}</sub>"
    else:
        foot_block = ""

    fig.update_layout(
        title=dict(
            text=data.title + foot_block,
            font=title_font,
        ),
        font=font_kw,
        barmode="overlay",
        bargap=layout_bargap,
        xaxis=xaxis_kw,
        yaxis=yaxis_kw,
        annotations=annotations,
        legend=legend_kw,
        margin=margin_kw,
        height=layout_height,
        template=tmpl,
        paper_bgcolor=paper_bg,
        plot_bgcolor=plot_bg,
    )
    return fig
