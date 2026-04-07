"""Reusable Plotly chart primitives for the snapshot suite.

Every function returns a ``go.Figure`` styled by the Plotly design system.
All colours/sizes come from ``PLOTLY_THEME`` — callers should never hard-code styling.

Primitives
----------
chart_hbar          Horizontal bar chart (ER decomposition, trailing returns)
chart_grouped_vbar  Grouped vertical bar (HR cascade, relative returns)
chart_stacked_area  Stacked area chart (ER history, vol contribution)
chart_multi_line    Multi-line time series (HR drift, cumulative returns)
chart_waterfall     Step-waterfall bar (return attribution)
chart_heatmap       Colour-coded grid (monthly returns, factor exposure)
chart_table         Styled Plotly table (peer comparison, stats)
chart_histogram     Return distribution histogram
chart_bullet        Bullet / gauge chart (volatility context)

Usage
-----
    from ._plotly_charts import chart_hbar
    from ._plotly_theme import PLOTLY_THEME, apply_theme

    apply_theme()
    fig = chart_hbar(labels, values, title="L3 ER Decomposition")
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px

from ._plotly_theme import PLOTLY_THEME

T = PLOTLY_THEME


# ═══════════════════════════════════════════════════════════════════════════
# 1. Horizontal bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_hbar(
    labels: Sequence[str],
    values: Sequence[float],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    value_fmt: str = "{:+.1f}%",
    sort: bool = False,
) -> go.Figure:
    """Horizontal bar chart — used for ER decomposition, trailing returns.

    Direct-labels each bar; no legend needed.
    """
    pal = T.palette
    fonts = T.fonts

    labels = list(labels)
    values = list(values)

    if sort:
        paired = sorted(zip(values, labels), key=lambda x: x[0])
        values, labels = zip(*paired) if paired else ([], [])
        values, labels = list(values), list(labels)

    n = len(labels)
    if colors is None:
        colors = (pal.factor_colors * ((n // 4) + 1))[:n]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        y=labels,
        x=values,
        orientation="h",
        marker=dict(
            color=list(colors),
            line=dict(width=0),
            cornerradius=4,
        ),
        text=[value_fmt.format(v) for v in values],
        textposition="outside",
        textfont=dict(
            family=fonts.family,
            size=fonts.annotation,
            color=pal.text_dark,
        ),
        cliponaxis=False,
        showlegend=False,
    ))

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
        yaxis=dict(autorange="reversed", showline=False, tickfont=dict(size=fonts.axis_tick)),
        xaxis=dict(visible=False, zeroline=False),
        bargap=0.3,
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 2. Grouped vertical bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_grouped_vbar(
    group_labels: Sequence[str],
    series: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    value_fmt: str = "{:.2f}",
    ylabel: str = "",
) -> go.Figure:
    """Grouped vertical bar — used for HR cascade, relative returns.

    Direct-labels each bar. Legend has no frame.
    """
    pal = T.palette
    fonts = T.fonts

    series_names = list(series.keys())
    n_series = len(series_names)

    if colors is None:
        colors = (pal.factor_colors * ((n_series // 4) + 1))[:n_series]

    fig = go.Figure()
    for i, name in enumerate(series_names):
        vals = series[name]
        fig.add_trace(go.Bar(
            x=list(group_labels),
            y=list(vals),
            name=name,
            marker=dict(
                color=colors[i],
                line=dict(width=0),
                cornerradius=3,
            ),
            text=[value_fmt.format(v) for v in vals],
            textposition="outside",
            textfont=dict(
                family=fonts.family,
                size=fonts.annotation - 1,
                color=pal.text_dark,
            ),
            cliponaxis=False,
        ))

    T.style(fig)
    fig.update_layout(
        barmode="group",
        bargap=0.25,
        bargroupgap=0.08,
        title=_title_dict(title) if title else None,
        yaxis_title=ylabel or None,
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 3. Stacked area
# ═══════════════════════════════════════════════════════════════════════════

def chart_stacked_area(
    dates: Sequence,
    series: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    ylabel: str = "",
    pct_fmt: bool = False,
) -> go.Figure:
    """Stacked area chart — ER history, volatility contribution."""
    pal = T.palette

    names = list(series.keys())
    n = len(names)

    if colors is None:
        colors = (pal.factor_colors * ((n // 4) + 1))[:n]

    fig = go.Figure()
    for i, name in enumerate(names):
        fig.add_trace(go.Scatter(
            x=list(dates),
            y=list(series[name]),
            name=name,
            mode="lines",
            stackgroup="one",
            line=dict(width=0.5, color=colors[i]),
            fillcolor=_with_alpha(colors[i], 0.75),
        ))

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
        yaxis_title=ylabel or None,
        yaxis_tickformat=".0%" if pct_fmt else None,
        xaxis=dict(
            tickformat="%b '%y",
            dtick="M2",
            tickangle=-30,
        ),
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 4. Multi-line
# ═══════════════════════════════════════════════════════════════════════════

def chart_multi_line(
    dates: Sequence,
    lines: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    ylabel: str = "",
    pct_fmt: bool = False,
    fill_between: str | None = None,
    zero_line: bool = False,
) -> go.Figure:
    """Multi-line time series — HR drift, cumulative returns.

    Parameters
    ----------
    fill_between : If set, fill between this series and zero.
    zero_line    : Draw a horizontal line at y=0.
    """
    pal = T.palette

    names = list(lines.keys())
    n = len(names)
    if colors is None:
        colors = (pal.series * ((n // len(pal.series)) + 1))[:n]

    fig = go.Figure()
    for i, name in enumerate(names):
        vals = list(lines[name])
        lw = 2.0 if i < 3 else 1.2

        fill = None
        fillcolor = None
        if fill_between and name == fill_between:
            fill = "tozeroy"
            fillcolor = _with_alpha(colors[i], 0.15)

        fig.add_trace(go.Scatter(
            x=list(dates),
            y=vals,
            name=name,
            mode="lines",
            line=dict(color=colors[i], width=lw),
            fill=fill,
            fillcolor=fillcolor,
        ))

    T.style(fig)

    updates: dict[str, Any] = {
        "title": _title_dict(title) if title else None,
        "yaxis_title": ylabel or None,
        "yaxis_tickformat": ".0%" if pct_fmt else None,
        "xaxis": dict(tickformat="%b '%y", dtick="M2", tickangle=-30),
    }
    if zero_line:
        updates["yaxis_zeroline"] = True
        updates["yaxis_zerolinecolor"] = pal.border
        updates["yaxis_zerolinewidth"] = 1

    fig.update_layout(**updates)
    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 5. Waterfall bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_waterfall(
    labels: Sequence[str],
    values: Sequence[float],
    *,
    title: str = "",
    value_fmt: str = "{:+.1f}%",
    total_label: str = "Total",
) -> go.Figure:
    """Step-waterfall bar — return attribution.

    Bars start where the previous one ended. Final bar shows total.
    """
    pal = T.palette
    fonts = T.fonts

    measures = ["relative"] * len(values) + ["total"]
    text = [value_fmt.format(v) for v in values] + [value_fmt.format(sum(values))]
    bar_labels = list(labels) + [total_label]

    fig = go.Figure(go.Waterfall(
        x=bar_labels,
        y=list(values) + [0],
        measure=measures,
        text=text,
        textposition="outside",
        textfont=dict(
            family=fonts.family,
            size=fonts.annotation,
            color=pal.text_dark,
        ),
        increasing=dict(marker=dict(color=pal.pos, line=dict(width=0))),
        decreasing=dict(marker=dict(color=pal.neg, line=dict(width=0))),
        totals=dict(marker=dict(color=pal.navy, line=dict(width=0))),
        connector=dict(line=dict(color=pal.text_light, width=0.8)),
        cliponaxis=False,
    ))

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
        xaxis_tickangle=-30,
        showlegend=False,
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 6. Heatmap
# ═══════════════════════════════════════════════════════════════════════════

def chart_heatmap(
    data: np.ndarray | pd.DataFrame,
    xlabels: Sequence[str],
    ylabels: Sequence[str],
    *,
    title: str = "",
    value_fmt: str = ".1%",
    colorscale: str | list | None = None,
    zmin: float | None = None,
    zmax: float | None = None,
) -> go.Figure:
    """Colour-coded grid — monthly returns, factor exposure.

    Uses a diverging red-white-green scale by default (symmetric around zero).
    """
    pal = T.palette

    if isinstance(data, pd.DataFrame):
        arr = data.values
    else:
        arr = np.asarray(data, dtype=float)

    if colorscale is None:
        colorscale = [[0, pal.neg], [0.5, "#ffffff"], [1, pal.pos]]

    if zmin is None:
        zmin = float(np.nanmin(arr))
    if zmax is None:
        zmax = float(np.nanmax(arr))
    if zmin < 0 and zmax > 0:
        abs_max = max(abs(zmin), abs(zmax))
        zmin, zmax = -abs_max, abs_max

    fig = go.Figure(go.Heatmap(
        z=arr.tolist(),
        x=list(xlabels),
        y=list(ylabels),
        colorscale=colorscale,
        zmin=zmin,
        zmax=zmax,
        text=[[value_fmt.replace("{:", "").replace("}", "") for _ in row] for row in arr],
        texttemplate=f"%{{z:{value_fmt.strip('{:}') if '{' in value_fmt else value_fmt}}}",
        textfont=dict(family=T.fonts.family, size=T.fonts.table_body),
        showscale=False,
        xgap=2,
        ygap=2,
    ))

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
        xaxis=dict(side="top", tickangle=-45),
        yaxis=dict(autorange="reversed"),
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 7. Styled table
# ═══════════════════════════════════════════════════════════════════════════

def chart_table(
    rows: Sequence[Sequence[str]],
    headers: Sequence[str],
    *,
    title: str = "",
    col_widths: Sequence[float] | None = None,
    highlight_col: int | None = None,
) -> go.Figure:
    """Styled Plotly table — peer comparison, stats summary.

    Parameters
    ----------
    rows           : List of rows, each a list of cell strings.
    headers        : Column header strings.
    col_widths     : Relative column widths (default: equal).
    highlight_col  : Column index to bold/colour (e.g. the target ticker).
    """
    pal = T.palette
    fonts = T.fonts

    n_cols = len(headers)
    n_rows = len(rows)

    # Transpose rows to columns for Plotly table format
    columns = list(zip(*rows)) if rows else [[] for _ in headers]

    # Build per-cell font styling for highlight
    cell_font_color = []
    cell_font_weight = []
    for j in range(n_cols):
        if highlight_col is not None and j == highlight_col:
            cell_font_color.append([pal.navy] * n_rows)
        else:
            cell_font_color.append([pal.text_dark] * n_rows)

    # Alternating row backgrounds
    row_fills = []
    for i in range(n_rows):
        row_fills.append("#ffffff" if i % 2 == 0 else "#f8f9fb")
    fill_colors = [row_fills for _ in range(n_cols)]

    fig = go.Figure(go.Table(
        columnwidth=list(col_widths) if col_widths else None,
        header=dict(
            values=[f"<b>{h}</b>" for h in headers],
            fill_color=pal.navy,
            font=dict(
                family=fonts.family,
                size=fonts.table_header,
                color="#ffffff",
            ),
            align="center",
            line=dict(color=pal.navy, width=1),
            height=32,
        ),
        cells=dict(
            values=list(columns),
            fill_color=fill_colors,
            font=dict(
                family=fonts.family,
                size=fonts.table_body,
                color=cell_font_color,
            ),
            align="center",
            line=dict(color=pal.axis_line, width=0.5),
            height=26,
        ),
    ))

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 8. Histogram
# ═══════════════════════════════════════════════════════════════════════════

def chart_histogram(
    values: Sequence[float],
    *,
    title: str = "",
    xlabel: str = "",
    current_value: float | None = None,
    bins: int = 40,
    pct_fmt: bool = False,
) -> go.Figure:
    """Return distribution histogram with optional current-value marker."""
    pal = T.palette

    fig = go.Figure()
    fig.add_trace(go.Histogram(
        x=list(values),
        nbinsx=bins,
        marker=dict(
            color=pal.slate,
            line=dict(color="#ffffff", width=0.5),
        ),
        opacity=0.8,
        showlegend=False,
    ))

    if current_value is not None:
        label = f"Current: {current_value:.1%}" if pct_fmt else f"Current: {current_value:.2f}"
        fig.add_vline(
            x=current_value,
            line=dict(color=pal.orange, width=2),
            annotation=dict(
                text=label,
                font=dict(family=T.fonts.family, size=T.fonts.annotation, color=pal.orange),
            ),
        )

    T.style(fig)
    fig.update_layout(
        title=_title_dict(title) if title else None,
        xaxis_title=xlabel or None,
        xaxis_tickformat=".0%" if pct_fmt else None,
        yaxis_title="Frequency",
        bargap=0.02,
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# 9. Bullet / gauge
# ═══════════════════════════════════════════════════════════════════════════

def chart_bullet(
    labels: Sequence[str],
    values: Sequence[float],
    ranges: Sequence[tuple[float, float]] | None = None,
    *,
    title: str = "",
    value_fmt: str = "{:.1f}%",
) -> go.Figure:
    """Horizontal bullet / gauge chart — volatility context.

    Parameters
    ----------
    labels  : Row labels (e.g. "Vol 23d", "Vol 63d").
    values  : Current values.
    ranges  : Optional (low, high) shading range per row.
    """
    pal = T.palette
    fonts = T.fonts

    fig = go.Figure()

    # Background range bars (if provided)
    if ranges:
        for i, ((lo, hi), label) in enumerate(zip(ranges, labels)):
            fig.add_trace(go.Bar(
                y=[label],
                x=[hi - lo],
                base=lo,
                orientation="h",
                marker=dict(color="#f0f2f5", line=dict(width=0)),
                showlegend=False,
                hoverinfo="skip",
            ))

    # Value bars
    fig.add_trace(go.Bar(
        y=list(labels),
        x=list(values),
        orientation="h",
        marker=dict(
            color=pal.navy,
            line=dict(width=0),
            cornerradius=3,
        ),
        text=[value_fmt.format(v) for v in values],
        textposition="outside",
        textfont=dict(
            family=fonts.family,
            size=fonts.annotation,
            color=pal.text_dark,
        ),
        cliponaxis=False,
        showlegend=False,
        width=0.4,
    ))

    T.style(fig)
    fig.update_layout(
        barmode="overlay",
        title=_title_dict(title) if title else None,
        yaxis=dict(autorange="reversed", showline=False),
        xaxis=dict(visible=False),
    )

    return fig


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _title_dict(text: str) -> dict[str, Any]:
    """Build a Tufte-style title config aligned with the design system."""
    return dict(
        text=f"<b>{text}</b>",
        font=dict(
            family=T.fonts.family,
            size=T.fonts.panel_title,
            color=T.palette.navy,
        ),
        x=0,
        xanchor="left",
        y=0.98,
        yanchor="top",
    )


def _with_alpha(hex_color: str, alpha: float) -> str:
    """Convert a hex color to rgba string with given alpha."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"
