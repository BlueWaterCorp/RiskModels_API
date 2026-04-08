"""MAG7-style horizontal stacked L3 risk decomposition (Plotly-first).

Adapter module: delegates to component dataclasses in ``components/``.
Plotting logic is centralized in ``styles`` (palette) and ``utils`` (σ, annotations, titles).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Literal

import pandas as pd

from ..lineage import RiskLineage
from .components.l3_decomposition import (
    L3DecompositionData,
    build_l3_decomposition_data,
    plot_l3_decomposition_from_data,
)
from ._base import RenderOptions

AnnotationMode = Literal["er_systematic", "rr_hr"]
PlotlyTheme = Literal["light", "terminal_dark"]


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
    universe_avg_vol: float | None = None,
) -> Any:
    """Horizontal stacked bars: L3 market / sector / subsector + residual (HR share).

    When ``sigma_scaled`` is True, total bar length is annualized σ (from ``vol_23d`` / ``volatility``
    via :func:`utils.annualized_vol_decimal`); segment length is σ × share.
    """
    if isinstance(rows, pd.DataFrame):
        if rows.empty:
            try:
                import plotly.graph_objects as go
            except ImportError as e:  # pragma: no cover
                raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
            return go.Figure()
    elif not rows:
        try:
            import plotly.graph_objects as go
        except ImportError as e:  # pragma: no cover
            raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
        return go.Figure()

    data = build_l3_decomposition_data(
        rows,
        sigma_scaled=sigma_scaled,
        annotation_mode=annotation_mode,
        title=title,
        subtitle=subtitle,
        metadata=metadata,
        lineage=lineage,
        tuple_from_row=tuple_from_row,
        universe_avg_vol=universe_avg_vol,
    )

    render_options = RenderOptions(theme=theme) if theme != "light" else None

    return plot_l3_decomposition_from_data(
        data,
        render_options=render_options,
        annotation_formatter=annotation_formatter,
    )
