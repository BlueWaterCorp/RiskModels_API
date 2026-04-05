"""MAG7-style horizontal stacked L3 risk decomposition (Plotly-first).

Plotting logic is centralized in ``styles`` (palette) and ``utils`` (σ, annotations, titles).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Literal, cast

import numpy as np
import pandas as pd

from ..lineage import RiskLineage
from . import styles
from .utils import (
    build_title,
    footnote_from_lineage,
    format_l3_annotation_er_systematic,
    format_l3_annotation_rr_hr,
    l3_er_tuple_from_row,
    l3_rr_tuple_from_row,
    sigma_array_from_rows,
)

AnnotationMode = Literal["er_systematic", "rr_hr"]
PlotlyTheme = Literal["light", "terminal_dark"]


def _require_plotly() -> tuple[Any, Any]:
    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
    return go, go.Figure


def plot_l3_horizontal(
    rows: list[dict[str, Any]] | pd.DataFrame,
    *,
    sigma_scaled: bool = True,
    style_preset: str = "l3_decomposition",
    annotation_mode: AnnotationMode = "rr_hr",
    title: str | None = None,
    subtitle: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
    tuple_from_row: Callable[[Mapping[str, Any]], tuple[float, float, float, float]] | None = None,
    annotation_formatter: Callable[[int, dict[str, Any]], str] | None = None,
    theme: PlotlyTheme = "light",
) -> Any:
    """Horizontal stacked bars: L3 market / sector / subsector + residual (HR share).

    When ``sigma_scaled`` is True, total bar length is annualized σ (from ``vol_23d`` / ``volatility``
    via :func:`utils.annualized_vol_decimal`); segment length is σ × share.
    """
    go, _Figure = _require_plotly()
    _ = styles.get_preset(cast(Any, style_preset))

    if isinstance(rows, pd.DataFrame):
        recs = rows.to_dict("records")
    else:
        recs = list(rows)

    tickers = [str(r.get("ticker", f"Row{i}")) for i, r in enumerate(recs)]
    n = len(tickers)
    if n == 0:
        fig = _Figure()
        return fig

    tfn = tuple_from_row or (l3_rr_tuple_from_row if annotation_mode == "rr_hr" else l3_er_tuple_from_row)
    mkt = np.array([tfn(r)[0] for r in recs], dtype=float)
    sec = np.array([tfn(r)[1] for r in recs], dtype=float)
    sub = np.array([tfn(r)[2] for r in recs], dtype=float)
    res = np.array([tfn(r)[3] for r in recs], dtype=float)

    if sigma_scaled:
        sigma = sigma_array_from_rows([dict(r) for r in recs])
        mkt_v, sec_v, sub_v, res_v = mkt * sigma, sec * sigma, sub * sigma, res * sigma
        totals = mkt_v + sec_v + sub_v + res_v
        data_max = float(np.nanmax(totals)) if n else 0.35
        if not np.isfinite(data_max):
            data_max = 0.35
        # Padded upper bound only (no fixed 60% floor). A constant 0.6 minimum made σ≈0.30 bars sit
        # on the left half of the axis with empty space to 60%.
        padded = max(float(data_max) * 1.08, 1e-9)
        xmax = float(np.ceil(padded * 20.0) / 20.0)  # next 0.05; vol labels stay readable
        xmax = max(xmax, 0.05)
        xmax = min(xmax, 2.0)
        # Finer grid when the span is small (e.g. σ·1 ≈ 0.25–0.40).
        sigma_x_dtick = 0.05 if xmax <= 0.45 else 0.1
        if annotation_mode == "rr_hr":
            x_title = (
                "Annualized σ of total return; segments = σ × "
                "(L3 market/sector/subsector RR + HR residual)"
            )
        else:
            x_title = "Annualized σ × variance share (total length ∝ σ)"
    else:
        mkt_v, sec_v, sub_v, res_v = mkt, sec, sub, res
        # Match article / investor copy: ER mode reads as “return variance” shares.
        x_title = (
            "Fraction of return variance (explained risk)"
            if annotation_mode == "er_systematic"
            else "Fraction of variance (explained risk)"
        )
        xmax = 1.0

    # Legend: RR/HR jargon vs plain “Market / … / Idiosyncratic” for ER explained-risk charts.
    if annotation_mode == "er_systematic":
        seg_names = ("Market", "Sector", "Subsector", "Idiosyncratic")
    else:
        seg_names = ("L3 market RR", "L3 sector RR", "L3 subsector RR", "HR")

    colors = styles.L3_LAYER_COLORS
    fig = _Figure()

    def add_seg(name: str, vals: np.ndarray, left: np.ndarray, color: str, show_legend: bool) -> np.ndarray:
        # Line color = fill at width 0 avoids Kaleido/SVG hairline glitches at segment joins.
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

    ann_font = dict(styles.ANNOTATION_FONT)
    if not sigma_scaled and annotation_mode == "er_systematic":
        ann_font = {
            **ann_font,
            "family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }
    if theme == "terminal_dark":
        ann_font = {**ann_font, "color": styles.TERMINAL_MUTED}

    _is_er_var = (not sigma_scaled) and annotation_mode == "er_systematic"
    _is_sigma_rr = sigma_scaled and annotation_mode == "rr_hr"

    annotations: list[dict[str, Any]] = []
    for i, r in enumerate(recs):
        rd = dict(r)
        if annotation_formatter is not None:
            txt = annotation_formatter(i, rd)
        elif annotation_mode == "rr_hr":
            txt = format_l3_annotation_rr_hr(rd)
        else:
            txt = format_l3_annotation_er_systematic(rd)
        # Variance-fraction mode: keep axis at 0–100%; place labels in paper coords so the x-range
        # does not stretch to ~125% (which made charts look “wrong” vs the article reference).
        if not sigma_scaled:
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

    meta = dict(metadata or {})
    if lineage:
        meta.setdefault("model_version", lineage.model_version)
        meta.setdefault("data_as_of", lineage.data_as_of)

    head = title or ("L3 risk DNA (σ-scaled, RR + HR)" if sigma_scaled else "L3 explained risk")
    full_title = build_title(head, metadata=meta, subtitle=subtitle)
    foot = footnote_from_lineage(lineage)
    if foot and theme == "terminal_dark":
        foot_block = f'<br><sub style="color:{styles.TERMINAL_MUTED}">{foot}</sub>'
    elif foot:
        foot_block = f"<br><sub>{foot}</sub>"
    else:
        foot_block = ""

    if theme == "terminal_dark":
        # Solid x-grid (Kaleido often drops dashed grids); bottom spine for structure.
        xaxis_kw = dict(
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
        if not sigma_scaled:
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
        if not sigma_scaled:
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
        if not sigma_scaled and annotation_mode == "er_systematic":
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

    # ER variance + σ-scaled RR (e.g. MAG7): airy rows / bargap; light theme matches article spines + grid.
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

    fig.update_layout(
        title=dict(
            text=full_title + foot_block,
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
