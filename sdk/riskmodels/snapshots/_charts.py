"""Reusable chart primitives for the snapshot suite.

Every function takes an ``Axes`` as its first argument, draws into it using
Consultant Navy styling, and returns the same ``Axes`` (for chaining).

All colours/sizes come from ``THEME`` — callers should never hard-code styling.

Primitives
----------
chart_hbar          Horizontal bar chart (ER decomposition, trailing returns)
chart_grouped_vbar  Grouped vertical bar (HR cascade, relative returns)
chart_stacked_area  Stacked area chart (ER history, vol contribution)
chart_multi_line    Multi-line time series (HR drift, cumulative returns)
chart_waterfall     Step-waterfall bar (return attribution)
chart_heatmap       Colour-coded grid (monthly returns, factor exposure)
chart_table         Styled Matplotlib table (peer comparison, stats)
chart_histogram     Return distribution histogram
chart_bullet        Bullet / gauge chart (volatility context)
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.axes import Axes
from matplotlib.colors import LinearSegmentedColormap

from ._theme import THEME


# ═══════════════════════════════════════════════════════════════════════════
# 1. Horizontal bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_hbar(
    ax: Axes,
    labels: Sequence[str],
    values: Sequence[float],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    value_fmt: str = "{:+.1f}%",
    sort: bool = False,
) -> Axes:
    """Horizontal bar chart — used for ER decomposition, trailing returns.

    Parameters
    ----------
    labels    : Category labels (top-to-bottom).
    values    : Numeric values (one per label).
    colors    : Bar colours (default: factor palette).
    title     : Panel title.
    value_fmt : Format string for bar-end annotations.
    sort      : If True, sort bars by value descending.
    """
    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    labels = list(labels)
    values = list(values)

    if sort:
        paired = sorted(zip(values, labels), reverse=True)
        values, labels = zip(*paired) if paired else ([], [])
        values, labels = list(values), list(labels)

    n = len(labels)
    if colors is None:
        colors = (pal.factor_colors * ((n // 4) + 1))[:n]

    y_pos = np.arange(n)
    bar_h = 0.55

    # Draw rounded-end bars using FancyBboxPatch for a polished look
    from matplotlib.patches import FancyBboxPatch

    for i, (v, color) in enumerate(zip(values, colors)):
        if abs(v) < 1e-9:
            continue
        x0 = min(0, v)
        w = abs(v)
        y0 = y_pos[i] - bar_h / 2

        # Subtle shadow (offset by 0.1 in both axes)
        shadow = FancyBboxPatch(
            (x0 + 0.08, y0 - 0.03), w, bar_h,
            boxstyle="round,pad=0.02",
            facecolor="#00000008",
            edgecolor="none",
            zorder=2,
            transform=ax.transData,
        )
        ax.add_patch(shadow)

        # Main bar with rounded ends
        bar = FancyBboxPatch(
            (x0, y0), w, bar_h,
            boxstyle="round,pad=0.02",
            facecolor=color,
            edgecolor="none",
            alpha=strk.bar_alpha,
            zorder=3,
            transform=ax.transData,
        )
        ax.add_patch(bar)

    # Value annotations — positioned just past bar end
    for i, v in enumerate(values):
        offset = 0.4 if v >= 0 else -0.4
        ax.text(
            v + offset, y_pos[i],
            value_fmt.format(v),
            va="center",
            ha="left" if v >= 0 else "right",
            fontsize=typ.annotation,
            fontweight="bold",
            color=pal.text_dark,
            zorder=4,
        )

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=typ.axis_tick, fontweight="600")
    ax.invert_yaxis()
    ax.axvline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)
    ax.set_axisbelow(True)

    # Pad xlim so annotation text doesn't clip at panel edges
    v_min = min(values) if values else 0
    v_max = max(values) if values else 0
    pad = max(abs(v_max), abs(v_min)) * 0.45 + 1.5
    ax.set_xlim(min(v_min - pad, -0.5), max(v_max + pad, 0.5))

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)

    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(left=False, bottom=False, labelbottom=False)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 2. Grouped vertical bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_grouped_vbar(
    ax: Axes,
    group_labels: Sequence[str],
    series: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    value_fmt: str = "{:.2f}",
    ylabel: str = "",
) -> Axes:
    """Grouped vertical bar — used for HR cascade, relative returns.

    Parameters
    ----------
    group_labels : X-axis group labels (e.g. ["L1", "L2", "L3"]).
    series       : {series_name: [values]}. One bar per series within each group.
    colors       : One colour per series.
    """
    from matplotlib.patches import FancyBboxPatch

    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    series_names = list(series.keys())
    n_groups = len(group_labels)
    n_series = len(series_names)

    if colors is None:
        colors = (pal.factor_colors * ((n_series // 4) + 1))[:n_series]

    x = np.arange(n_groups)
    bar_w = 0.7 / n_series

    for i, name in enumerate(series_names):
        vals = series[name]
        offset = (i - n_series / 2 + 0.5) * bar_w

        for j, v in enumerate(vals):
            if abs(v) < 1e-9:
                continue
            cx = x[j] + offset
            x0 = cx - bar_w / 2
            y0 = min(0, v)
            h = abs(v)

            # Subtle shadow
            shadow = FancyBboxPatch(
                (x0 + 0.02, y0 - 0.008), bar_w, h,
                boxstyle="round,pad=0.01",
                facecolor="#00000008",
                edgecolor="none",
                zorder=2,
                transform=ax.transData,
            )
            ax.add_patch(shadow)

            # Rounded bar
            bar = FancyBboxPatch(
                (x0, y0), bar_w, h,
                boxstyle="round,pad=0.01",
                facecolor=colors[i],
                edgecolor="none",
                alpha=strk.bar_alpha,
                zorder=3,
                transform=ax.transData,
            )
            ax.add_patch(bar)

        # Invisible bars for legend only
        ax.bar([], [], bar_w, label=name, color=colors[i], alpha=strk.bar_alpha)

        # Value labels on top (skip near-zero values to reduce clutter)
        for j, v in enumerate(vals):
            if abs(v) < 1e-6:
                continue
            cx = x[j] + offset
            ax.text(
                cx, v + 0.01,
                value_fmt.format(v),
                ha="center", va="bottom",
                fontsize=typ.annotation - 1,
                fontweight="600",
                color=pal.text_dark,
                zorder=4,
            )

    ax.set_xticks(x)
    ax.set_xticklabels(group_labels, fontsize=typ.axis_tick, fontweight="600")
    ax.axhline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)
    ax.set_axisbelow(True)

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=typ.axis_label)

    ax.legend(fontsize=typ.axis_tick, loc="upper right", ncol=min(n_series, 4))
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(left=False)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 3. Stacked area
# ═══════════════════════════════════════════════════════════════════════════

def chart_stacked_area(
    ax: Axes,
    dates: Sequence,
    series: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    ylabel: str = "",
    pct_fmt: bool = False,
) -> Axes:
    """Stacked area chart — ER history, volatility contribution.

    Parameters
    ----------
    dates  : X-axis dates.
    series : {name: [values]} — order determines stacking order.
    """
    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    names = list(series.keys())
    data = [series[n] for n in names]
    n = len(names)

    if colors is None:
        colors = (pal.factor_colors * ((n // 4) + 1))[:n]

    ax.stackplot(
        dates, *data,
        labels=names,
        colors=colors,
        alpha=0.75,
        zorder=3,
    )

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=typ.axis_label)
    if pct_fmt:
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:.0%}"))

    ax.legend(fontsize=typ.axis_tick, loc="upper left", ncol=min(n, 4))
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    _format_date_axis(ax)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 4. Multi-line
# ═══════════════════════════════════════════════════════════════════════════

def chart_multi_line(
    ax: Axes,
    dates: Sequence,
    lines: dict[str, Sequence[float]],
    *,
    colors: Sequence[str] | None = None,
    title: str = "",
    ylabel: str = "",
    pct_fmt: bool = False,
    fill_between: str | None = None,
    zero_line: bool = False,
) -> Axes:
    """Multi-line time series — HR drift, cumulative returns.

    Parameters
    ----------
    lines         : {name: [values]}.
    fill_between  : If set, fill between this series and zero.
    zero_line     : Draw a horizontal line at y=0.
    """
    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    names = list(lines.keys())
    n = len(names)
    if colors is None:
        colors = (pal.series * ((n // len(pal.series)) + 1))[:n]

    for i, name in enumerate(names):
        vals = lines[name]
        lw = strk.series_lw if i < 3 else strk.thin_lw
        ax.plot(dates, vals, label=name, color=colors[i], linewidth=lw, zorder=3 + i)

        if fill_between and name == fill_between:
            ax.fill_between(
                dates, 0, vals,
                color=colors[i], alpha=strk.fill_alpha, zorder=2,
            )

    if zero_line:
        ax.axhline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=typ.axis_label)
    if pct_fmt:
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:.0%}"))

    ax.legend(fontsize=typ.axis_tick, loc="best", ncol=min(n, 4))
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    _format_date_axis(ax)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 5. Waterfall bar
# ═══════════════════════════════════════════════════════════════════════════

def chart_waterfall(
    ax: Axes,
    labels: Sequence[str],
    values: Sequence[float],
    *,
    title: str = "",
    value_fmt: str = "{:+.1f}%",
    total_label: str = "Total",
) -> Axes:
    """Step-waterfall bar — return attribution.

    Bars start where the previous one ended. Final bar shows total.
    """
    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    labels = list(labels)
    values = list(values)
    n = len(labels)

    # Compute bottoms (running sum)
    cumulative = np.zeros(n + 1)
    for i, v in enumerate(values):
        cumulative[i + 1] = cumulative[i] + v

    bottoms = cumulative[:-1]
    total = cumulative[-1]

    # Component bars
    bar_colors = [pal.pos if v >= 0 else pal.neg for v in values]
    ax.bar(
        range(n), values, bottom=bottoms,
        color=bar_colors,
        edgecolor=pal.panel_bg,
        linewidth=strk.bar_edge_lw,
        alpha=strk.bar_alpha,
        width=0.6,
        zorder=3,
    )

    # Total bar
    ax.bar(
        n, total, bottom=0,
        color=pal.navy,
        edgecolor=pal.panel_bg,
        linewidth=strk.bar_edge_lw,
        alpha=strk.bar_alpha,
        width=0.6,
        zorder=3,
    )

    # Connector lines
    for i in range(n):
        ax.plot(
            [i + 0.3, i + 0.7], [cumulative[i + 1]] * 2,
            color=pal.text_light, linewidth=strk.thin_lw * 0.5, zorder=2,
        )

    # Value labels
    for i, v in enumerate(values):
        y = bottoms[i] + v
        ax.text(i, y + (0.002 if v >= 0 else -0.002), value_fmt.format(v),
                ha="center", va="bottom" if v >= 0 else "top",
                fontsize=typ.annotation, fontweight="bold", color=pal.text_dark, zorder=4)

    ax.text(n, total + 0.002, value_fmt.format(total),
            ha="center", va="bottom", fontsize=typ.annotation,
            fontweight="bold", color=pal.navy, zorder=4)

    all_labels = labels + [total_label]
    ax.set_xticks(range(n + 1))
    ax.set_xticklabels(all_labels, fontsize=typ.axis_tick, rotation=30, ha="right")
    ax.axhline(0, color=pal.border, linewidth=strk.thin_lw, zorder=2)

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)

    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 6. Heatmap
# ═══════════════════════════════════════════════════════════════════════════

def chart_heatmap(
    ax: Axes,
    data: np.ndarray | pd.DataFrame,
    xlabels: Sequence[str],
    ylabels: Sequence[str],
    *,
    title: str = "",
    value_fmt: str = "{:.1f}%",
    cmap: str | None = None,
    vmin: float | None = None,
    vmax: float | None = None,
) -> Axes:
    """Colour-coded grid — monthly returns, factor exposure.

    Parameters
    ----------
    data     : 2D array (rows × cols).
    xlabels  : Column headers.
    ylabels  : Row headers.
    """
    pal = THEME.palette
    typ = THEME.type

    if isinstance(data, pd.DataFrame):
        arr = data.values
    else:
        arr = np.asarray(data, dtype=float)

    if cmap is None:
        cmap_obj = LinearSegmentedColormap.from_list(
            "navy_green", [pal.neg, "#ffffff", pal.pos], N=256,
        )
    else:
        cmap_obj = plt.get_cmap(cmap)

    if vmin is None:
        vmin = float(np.nanmin(arr))
    if vmax is None:
        vmax = float(np.nanmax(arr))
    # Symmetric around zero if data straddles zero
    abs_max = max(abs(vmin), abs(vmax))
    if vmin < 0 and vmax > 0:
        vmin, vmax = -abs_max, abs_max

    im = ax.imshow(arr, cmap=cmap_obj, aspect="auto", vmin=vmin, vmax=vmax, zorder=2)

    # Annotate cells
    for i in range(arr.shape[0]):
        for j in range(arr.shape[1]):
            v = arr[i, j]
            if np.isnan(v):
                continue
            text_color = "#ffffff" if abs(v) > abs_max * 0.6 else pal.text_dark
            ax.text(j, i, value_fmt.format(v),
                    ha="center", va="center",
                    fontsize=typ.table_body, color=text_color, zorder=3)

    ax.set_xticks(range(len(xlabels)))
    ax.set_xticklabels(xlabels, fontsize=typ.axis_tick, rotation=45, ha="right")
    ax.set_yticks(range(len(ylabels)))
    ax.set_yticklabels(ylabels, fontsize=typ.axis_tick)

    ax.set_axisbelow(False)
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 7. Styled table
# ═══════════════════════════════════════════════════════════════════════════

def chart_table(
    ax: Axes,
    rows: Sequence[Sequence[str]],
    headers: Sequence[str],
    *,
    title: str = "",
    col_widths: Sequence[float] | None = None,
    highlight_col: int | None = None,
) -> Axes:
    """Styled Matplotlib table — peer comparison, stats summary.

    Parameters
    ----------
    rows           : List of rows, each a list of cell strings.
    headers        : Column header strings.
    col_widths     : Relative column widths (default: equal).
    highlight_col  : Column index to bold/colour (e.g. the target ticker).
    """
    pal = THEME.palette
    typ = THEME.type

    ax.axis("off")

    n_cols = len(headers)
    if col_widths is None:
        col_widths = [1.0 / n_cols] * n_cols

    table = ax.table(
        cellText=rows,
        colLabels=headers,
        colWidths=col_widths,
        loc="center",
        cellLoc="center",
    )

    table.auto_set_font_size(False)
    table.set_fontsize(typ.table_body)

    # Scale row height to fill panel — more rows = less height each
    n_rows = len(rows) + 1  # +1 for header
    row_scale = max(1.6, 6.0 / n_rows)
    table.scale(1.0, row_scale)

    # Style header row
    for j in range(n_cols):
        cell = table[0, j]
        cell.set_facecolor(pal.navy)
        cell.set_text_props(
            color="#ffffff",
            fontweight="bold",
            fontsize=typ.table_header,
        )
        cell.set_edgecolor(pal.navy)

    # Style data rows
    for i in range(1, len(rows) + 1):
        for j in range(n_cols):
            cell = table[i, j]
            cell.set_facecolor(pal.panel_bg if i % 2 == 1 else pal.chip_bg)
            cell.set_edgecolor(pal.grid)
            cell.set_text_props(fontsize=typ.table_body, color=pal.text_dark)

            if highlight_col is not None and j == highlight_col:
                cell.set_text_props(fontweight="bold", color=pal.navy)

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 8. Histogram
# ═══════════════════════════════════════════════════════════════════════════

def chart_histogram(
    ax: Axes,
    values: Sequence[float],
    *,
    title: str = "",
    xlabel: str = "",
    current_value: float | None = None,
    bins: int = 40,
    pct_fmt: bool = False,
) -> Axes:
    """Return distribution histogram with optional current-value marker.

    Parameters
    ----------
    values         : Distribution of values.
    current_value  : If set, draw a vertical line + annotation.
    """
    pal = THEME.palette
    strk = THEME.strokes
    typ = THEME.type

    ax.hist(
        values, bins=bins,
        color=pal.slate,
        alpha=0.7,
        edgecolor=pal.panel_bg,
        linewidth=strk.bar_edge_lw,
        zorder=3,
    )

    if current_value is not None:
        ax.axvline(
            current_value,
            color=pal.orange,
            linewidth=strk.series_lw,
            linestyle="-",
            zorder=5,
            label=f"Current: {current_value:.1%}" if pct_fmt else f"Current: {current_value:.2f}",
        )
        ax.legend(fontsize=typ.axis_tick, loc="upper right")

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=typ.axis_label)
    if pct_fmt:
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:.0%}"))

    ax.set_ylabel("Frequency", fontsize=typ.axis_label)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# 9. Bullet / gauge (bonus — used by R1 vol context)
# ═══════════════════════════════════════════════════════════════════════════

def chart_bullet(
    ax: Axes,
    labels: Sequence[str],
    values: Sequence[float],
    ranges: Sequence[tuple[float, float]] | None = None,
    *,
    title: str = "",
    value_fmt: str = "{:.1f}%",
) -> Axes:
    """Horizontal bullet / gauge chart — volatility context.

    Parameters
    ----------
    labels  : Row labels (e.g. "Vol 23d", "Vol 63d").
    values  : Current values.
    ranges  : Optional (low, high) shading range per row.
    """
    pal = THEME.palette
    typ = THEME.type

    n = len(labels)
    y_pos = np.arange(n)

    if ranges:
        for i, (lo, hi) in enumerate(ranges):
            ax.barh(i, hi - lo, left=lo, height=0.5,
                    color=pal.chip_bg, edgecolor="none", zorder=1)

    ax.barh(y_pos, values, height=0.3, color=pal.navy, alpha=0.85, zorder=3)

    for i, v in enumerate(values):
        ax.text(v + 0.2, i, value_fmt.format(v),
                va="center", fontsize=typ.annotation, fontweight="bold",
                color=pal.text_dark, zorder=4)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=typ.axis_tick)
    ax.invert_yaxis()

    if title:
        ax.set_title(title, fontsize=typ.panel_title, fontweight="bold",
                      color=pal.navy, loc="left", pad=8)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(left=False)
    ax.set_axisbelow(True)

    return ax


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _format_date_axis(ax: Axes) -> None:
    """Auto-format x-axis for date-like data."""
    import matplotlib.dates as mdates

    try:
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    except Exception:
        # If data isn't datetime-native, just leave the default
        pass

    for label in ax.get_xticklabels():
        label.set_rotation(30)
        label.set_ha("right")
        label.set_fontsize(THEME.type.axis_tick)
