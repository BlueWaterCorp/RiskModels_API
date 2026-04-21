"""Two-panel side-by-side cumulative-return waterfall comparator.

Renders two ``P1Data`` geometric-attribution waterfalls as a 1×2 subplot with
a shared y-axis (cumulative return %) and independent x-axes (the factor
chain — SPY, sector ETF, subsector ETF, α Residual — differs per stock).

Pure rendering. No API calls. Expects fully-built ``P1Data`` objects.

Example
-------
    from riskmodels.snapshots.p1_stock_performance import P1Data
    from riskmodels.snapshots._compare_waterfall import render_waterfall_compare

    aapl = P1Data.from_json("AAPL_p1_cache.json")
    nvda = P1Data.from_json("NVDA_p1_cache.json")
    render_waterfall_compare(
        aapl, nvda, "tech_waterfall_compare.png",
        title="AAPL vs NVDA — same 'tech' label, different return shapes",
        subtitle="Trailing-year cumulative return decomposed via geometric attribution",
    )
"""
from __future__ import annotations

from pathlib import Path

import plotly.graph_objects as go
from plotly.subplots import make_subplots

from ._plotly_theme import PLOTLY_THEME as T, apply_theme
from .p1_stock_performance import P1Data, _make_cum_waterfall


def render_waterfall_compare(
    left: P1Data,
    right: P1Data,
    out_path: str | Path,
    *,
    title: str | None = None,
    subtitle: str | None = None,
    width: int = 1200,
    height: int = 560,
    horizontal_spacing: float = 0.09,
    scale: int = 2,
    color_remap: dict[str, str] | None = None,
) -> Path:
    """Render two side-by-side cumulative-return waterfalls to PNG.

    Parameters
    ----------
    left, right
        Fully-built P1Data objects (the two stocks to compare).
    out_path
        PNG destination.
    title, subtitle
        Optional page header. ``title`` is rendered in navy bold; ``subtitle``
        below it in teal.
    width, height
        Output pixel dimensions before ``scale`` multiplier.
    horizontal_spacing
        Gap between the two panels, in paper fraction.
    scale
        Plotly ``write_image`` scale multiplier (2 ≈ retina).
    """
    apply_theme()
    out_path = Path(out_path)

    left_wf = _make_cum_waterfall(left)
    right_wf = _make_cum_waterfall(right)

    left_gross = _gross_pct(left)
    right_gross = _gross_pct(right)

    subplot_titles = [
        _panel_title(left.ticker, left_gross),
        _panel_title(right.ticker, right_gross),
    ]

    combined = make_subplots(
        rows=1, cols=2,
        shared_yaxes=True,
        horizontal_spacing=horizontal_spacing,
        subplot_titles=subplot_titles,
    )

    _copy_panel(left_wf, combined, col=1)
    _copy_panel(right_wf, combined, col=2)

    # Optional per-series color remap applied to every bar trace.  Used by
    # Part 1 to swap the SDK's default slate (#2a7fbf) L3-subsector fill
    # for amber (#d97706) so it matches the opening NVDA chart's table
    # swatch and left-panel SMH line.  Remap is applied to both scalar
    # fills and per-bar color arrays.
    if color_remap:
        for trace in combined.data:
            if not isinstance(trace, go.Bar) or trace.marker is None:
                continue
            c = trace.marker.color
            if isinstance(c, str) and c in color_remap:
                trace.marker.color = color_remap[c]
            elif isinstance(c, (list, tuple)):
                trace.marker.color = [color_remap.get(x, x) for x in c]

    y_min, y_max = _union_yrange(left_wf, right_wf, (left_gross, right_gross))
    combined.update_yaxes(range=[y_min, y_max], row=1, col=1)
    combined.update_yaxes(range=[y_min, y_max], row=1, col=2)

    # T.style() first (it applies the global Tufte theme via update_layout
    # which targets xaxis/yaxis by default and would overwrite per-subplot
    # overrides if applied AFTER them).
    T.style(combined)

    # Half-frame dark axis convention (shared with the NVDA opening chart),
    # applied per-subplot AFTER T.style() so BOTH columns pick up the
    # darker spine uniformly:
    #   • left y-spine + bottom x-spine only (no top/right box)
    #   • slate-600 tone (#475569) at 1.2 px
    #   • darkened zero-line — shared "sea level" across every figure
    AXIS_SPINE_COLOR = "#475569"
    AXIS_SPINE_WIDTH = 1.2
    for col in (1, 2):
        combined.update_yaxes(
            showline=True, linecolor=AXIS_SPINE_COLOR, linewidth=AXIS_SPINE_WIDTH,
            mirror=False,
            zeroline=True, zerolinecolor=AXIS_SPINE_COLOR, zerolinewidth=1.5,
            ticksuffix="%", tickfont=dict(size=T.fonts.axis_tick),
            row=1, col=col,
        )
        combined.update_xaxes(
            showline=True, linecolor=AXIS_SPINE_COLOR, linewidth=AXIS_SPINE_WIDTH,
            mirror=False,
            title=None, tickfont=dict(size=T.fonts.axis_tick),
            row=1, col=col,
        )
    combined.update_yaxes(title="Cumulative Return (%)", row=1, col=1)

    # Subplot-title annotations (per-panel "TICKER +X.X% gross") sit at the
    # top of each subplot domain.  Nudge them ABOVE the plot area so they
    # can't collide with the gross-reference line/label drawn near y_max.
    for ann in combined.layout.annotations:
        if ann.text in subplot_titles:
            ann.y = (ann.y or 1.0) + 0.02   # lift clear of the plot
            ann.yanchor = "bottom"

    combined.update_layout(
        barmode="stack",
        bargap=0.28,
        title=dict(
            text=_build_header(title, subtitle),
            x=0.01, xanchor="left",
            y=0.97, yanchor="top",
            font=dict(size=20, color=T.palette.navy),
        ),
        height=height, width=width,
        margin=dict(t=140, b=55, l=75, r=40),
        showlegend=False,
        plot_bgcolor="white",
        paper_bgcolor="white",
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    combined.write_image(str(out_path), scale=scale)
    return out_path


def _gross_pct(p: P1Data) -> float:
    return (p.cum_stock[-1][1] if p.cum_stock else 0.0) * 100


def _panel_title(ticker: str, gross_pct: float) -> str:
    color = T.palette.green if gross_pct >= 0 else T.palette.orange
    return (
        f"<b>{ticker}</b>  "
        f"<span style='color:{color};font-weight:600'>{gross_pct:+.1f}%</span> "
        f"<span style='color:{T.palette.text_mid};font-weight:normal;font-size:12px'>gross</span>"
    )


def _copy_panel(src: go.Figure, dst: go.Figure, *, col: int) -> None:
    """Copy traces, annotations, and shapes from a standalone waterfall.

    With ``shared_yaxes=True`` in a 1×N layout, all columns reference yaxis
    ``"y"`` — only the xref changes (``"x"`` → ``"x{col}"``).
    """
    x_ref_new = "x" if col == 1 else f"x{col}"
    y_ref_new = "y"

    for trace in src.data:
        dst.add_trace(trace, row=1, col=col)

    for ann in src.layout.annotations:
        d = ann.to_plotly_json()
        if d.get("xref", "x") == "x":
            d["xref"] = x_ref_new
        if d.get("yref", "y") == "y":
            d["yref"] = y_ref_new
        dst.add_annotation(**d)

    for shape in src.layout.shapes:
        s = shape.to_plotly_json()
        src_xref = s.get("xref", "x")
        if src_xref == "paper":
            s["xref"] = f"{x_ref_new} domain"
            s["x0"], s["x1"] = 0.0, 1.0
        elif src_xref == "x":
            s["xref"] = x_ref_new
        if s.get("yref", "y") == "y":
            s["yref"] = y_ref_new
        dst.add_shape(**s)


def _union_yrange(
    left: go.Figure, right: go.Figure, gross_values: tuple[float, float]
) -> tuple[float, float]:
    """Shared y-range covering both standalone waterfalls plus headroom."""
    def _range(fig: go.Figure) -> tuple[float, float]:
        full = fig.full_figure_for_development(warn=False)
        r = full.layout.yaxis.range
        return (float(r[0]), float(r[1])) if r else (0.0, 10.0)

    l_min, l_max = _range(left)
    r_min, r_max = _range(right)
    g_top = max(gross_values)
    g_bot = min(gross_values)
    y_min = min(0.0, l_min, r_min, g_bot * 1.05 if g_bot < 0 else 0.0)
    y_max = max(l_max, r_max, g_top * 1.08 if g_top > 0 else 0.0)
    return y_min, y_max


def _build_header(title: str | None, subtitle: str | None) -> str:
    lines: list[str] = []
    lines.append(f"<b>{title}</b>" if title else "<b>Cumulative Return Decomposition</b>")
    if subtitle:
        lines.append(
            f"<span style='font-size:13px;color:{T.palette.teal};font-weight:normal'>"
            f"{subtitle}</span>"
        )
    return "<br>".join(lines)
