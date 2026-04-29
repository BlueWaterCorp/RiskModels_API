"""MAG7-style horizontal stacked L3 risk decomposition (Plotly-first).

Adapter module: delegates to component dataclasses in ``components/``.
Plotting logic is centralized in ``styles`` (palette) and ``utils`` (σ, annotations, titles).
"""

from __future__ import annotations

import dataclasses
import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal

import pandas as pd

from ..lineage import RiskLineage
from ._base import RenderOptions
from .components.l3_decomposition import (
    build_l3_decomposition_data,
    plot_l3_decomposition_from_data,
)

AnnotationMode = Literal["er_systematic", "rr_hr"]
PlotlyTheme = Literal["light", "terminal_dark"]
L3Metric = Literal["variance", "return"]
L3Mode = Literal["timeseries", "snapshot"]

L3_API_LAYER_COLORS: dict[str, str] = {
    "market": "#6b7280",
    "sector": "#2563eb",
    "subsector": "#7c3aed",
    "residual": "#ea580c",
}


@dataclasses.dataclass(frozen=True)
class L3ApiFieldMapping:
    """Exact raw API field paths for one L3 visual contract."""

    source: str
    metric: L3Metric
    x_field: str | None
    fields: Mapping[str, str]
    total_field: str | None = None
    systematic_field: str | None = None


L3_API_FIELD_MAPPINGS: tuple[L3ApiFieldMapping, ...] = (
    L3ApiFieldMapping(
        source="/l3-decomposition",
        metric="variance",
        x_field="dates",
        fields={
            "market": "l3_market_er",
            "sector": "l3_sector_er",
            "subsector": "l3_subsector_er",
            "residual": "l3_residual_er",
        },
    ),
    L3ApiFieldMapping(
        source="/decompose",
        metric="variance",
        x_field="data_as_of",
        fields={
            "market": "exposure.market.er",
            "sector": "exposure.sector.er",
            "subsector": "exposure.subsector.er",
            "residual": "exposure.residual.er",
        },
        total_field="_data_health.er_sum",
    ),
    L3ApiFieldMapping(
        source="/portfolio/risk-snapshot",
        metric="variance",
        x_field="as_of",
        fields={
            "market": "portfolio_risk_index.variance_decomposition.market",
            "sector": "portfolio_risk_index.variance_decomposition.sector",
            "subsector": "portfolio_risk_index.variance_decomposition.subsector",
            "residual": "portfolio_risk_index.variance_decomposition.residual",
        },
        systematic_field="portfolio_risk_index.variance_decomposition.systematic",
    ),
    L3ApiFieldMapping(
        source="/snapshot",
        metric="variance",
        x_field="snapshot.as_of",
        fields={
            "market": "snapshot.variance_decomposition.market",
            "sector": "snapshot.variance_decomposition.sector",
            "subsector": "snapshot.variance_decomposition.subsector",
            "residual": "snapshot.variance_decomposition.residual",
        },
    ),
    L3ApiFieldMapping(
        source="/snapshot",
        metric="return",
        x_field="attribution.teo",
        fields={
            "market": "attribution.market",
            "sector": "attribution.sector",
            "subsector": "attribution.subsector",
            "residual": "attribution.residual",
        },
        total_field="attribution.gross",
        systematic_field="attribution.systematic",
    ),
)


class L3DecompositionMappingError(ValueError):
    """Raised when raw API JSON cannot be mapped to exact L3 fields."""


def _get_path(data: Mapping[str, Any], path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            raise KeyError(path)
        cur = cur[part]
    return cur


def _has_path(data: Mapping[str, Any], path: str) -> bool:
    try:
        _get_path(data, path)
        return True
    except KeyError:
        return False


def _as_sequence(value: Any, *, field: str) -> list[Any]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        return [value]
    return list(value)


def _as_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _resolve_l3_mapping(data: Mapping[str, Any], metric: L3Metric) -> L3ApiFieldMapping:
    candidates = [m for m in L3_API_FIELD_MAPPINGS if m.metric == metric]
    for mapping in candidates:
        paths = list(mapping.fields.values())
        if mapping.x_field is not None:
            paths.append(mapping.x_field)
        if all(_has_path(data, path) for path in paths):
            return mapping

    available = sorted(str(k) for k in data.keys())
    expected = [
        f"{m.source}: {', '.join(m.fields.values())}"
        for m in candidates
    ]
    raise L3DecompositionMappingError(
        f"No exact L3 {metric!r} field mapping matched raw API JSON. "
        f"Top-level fields: {available}. Expected one of: {expected}."
    )


def _validate_l3_totals(
    *,
    layer_values: Mapping[str, list[Any]],
    total_values: list[Any] | None,
    total_field: str | None,
    systematic_values: list[Any] | None,
    systematic_field: str | None,
    tolerance: float,
) -> None:
    n = len(next(iter(layer_values.values())))
    if total_values is not None and len(total_values) != n:
        raise L3DecompositionMappingError(
            f"Total field {total_field!r} length {len(total_values)} does not match L3 field length {n}."
        )
    if systematic_values is not None and len(systematic_values) != n:
        raise L3DecompositionMappingError(
            f"Systematic field {systematic_field!r} length {len(systematic_values)} does not match L3 field length {n}."
        )

    for i in range(n):
        market = _as_float_or_none(layer_values["market"][i])
        sector = _as_float_or_none(layer_values["sector"][i])
        subsector = _as_float_or_none(layer_values["subsector"][i])
        residual = _as_float_or_none(layer_values["residual"][i])
        if None in (market, sector, subsector, residual):
            continue

        if total_values is not None:
            total = _as_float_or_none(total_values[i])
            if total is not None and abs((market + sector + subsector + residual) - total) > tolerance:
                raise L3DecompositionMappingError(
                    f"L3 fields do not sum to {total_field!r} at index {i}: "
                    f"market+sector+subsector+residual={market + sector + subsector + residual:.12g}, "
                    f"{total_field}={total:.12g}."
                )

        if systematic_values is not None:
            systematic = _as_float_or_none(systematic_values[i])
            if systematic is not None and abs((market + sector + subsector) - systematic) > tolerance:
                raise L3DecompositionMappingError(
                    f"L3 systematic fields do not sum to {systematic_field!r} at index {i}: "
                    f"market+sector+subsector={market + sector + subsector:.12g}, "
                    f"{systematic_field}={systematic:.12g}."
                )


def plot_l3_decomposition(
    data: Mapping[str, Any],
    metric: L3Metric = "variance",
    mode: L3Mode = "timeseries",
    *,
    title: str | None = None,
    tolerance: float = 1e-6,
) -> Any:
    """Plot exact L3 fields from raw RiskModels API JSON.

    The mapping layer is intentionally explicit: labels and traces cite the
    exact API field paths used for market, sector, subsector, and residual.
    Values are plotted as returned by the API; no smoothing, normalization, or
    unit reinterpretation is applied.
    """
    if metric not in ("variance", "return"):
        raise ValueError("metric must be 'variance' or 'return'")
    if mode not in ("timeseries", "snapshot"):
        raise ValueError("mode must be 'timeseries' or 'snapshot'")
    if not isinstance(data, Mapping):
        raise TypeError("data must be raw API JSON decoded to a mapping")

    try:
        import plotly.graph_objects as go
    except ImportError as e:  # pragma: no cover
        raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e

    mapping = _resolve_l3_mapping(data, metric)
    x_raw = _get_path(data, mapping.x_field) if mapping.x_field else list(range(1))
    x_values = _as_sequence(x_raw, field=mapping.x_field or "index")
    layer_values = {
        layer: _as_sequence(_get_path(data, field), field=field)
        for layer, field in mapping.fields.items()
    }

    lengths = {field: len(values) for field, values in layer_values.items()}
    lengths[mapping.x_field or "index"] = len(x_values)
    if len(set(lengths.values())) != 1:
        raise L3DecompositionMappingError(f"L3 field lengths do not match: {lengths}.")

    total_values = (
        _as_sequence(_get_path(data, mapping.total_field), field=mapping.total_field)
        if mapping.total_field and _has_path(data, mapping.total_field)
        else None
    )
    systematic_values = (
        _as_sequence(_get_path(data, mapping.systematic_field), field=mapping.systematic_field)
        if mapping.systematic_field and _has_path(data, mapping.systematic_field)
        else None
    )
    _validate_l3_totals(
        layer_values=layer_values,
        total_values=total_values,
        total_field=mapping.total_field,
        systematic_values=systematic_values,
        systematic_field=mapping.systematic_field,
        tolerance=tolerance,
    )

    fig = go.Figure()
    fields_for_meta = dict(mapping.fields)
    if mode == "timeseries":
        for layer, field in mapping.fields.items():
            fig.add_trace(
                go.Scatter(
                    x=x_values,
                    y=layer_values[layer],
                    mode="lines",
                    stackgroup="l3",
                    name=f"{layer}: {field}",
                    line=dict(width=0.5, color=L3_API_LAYER_COLORS[layer]),
                    fillcolor=L3_API_LAYER_COLORS[layer],
                    hovertemplate=f"{mapping.x_field}: %{{x}}<br>{field}: %{{y}}<extra></extra>",
                )
            )
        x_title = mapping.x_field or "index"
    else:
        latest_idx = len(x_values) - 1
        fig.add_trace(
            go.Bar(
                x=[layer_values[layer][latest_idx] for layer in mapping.fields],
                y=list(mapping.fields),
                customdata=[mapping.fields[layer] for layer in mapping.fields],
                orientation="h",
                marker=dict(color=[L3_API_LAYER_COLORS[layer] for layer in mapping.fields]),
                hovertemplate="%{y}<br>%{customdata}: %{x}<extra></extra>",
                name="exact API field values",
            )
        )
        x_title = f"{metric} values from API fields"

    fig.update_layout(
        title=title or f"L3 {metric} decomposition ({mapping.source})",
        xaxis_title=x_title,
        yaxis_title="exact API field value" if mode == "timeseries" else "L3 layer",
        template="plotly_white",
        hovermode="x unified" if mode == "timeseries" else "closest",
        legend_title_text="L3 mapping",
        meta={
            "source": mapping.source,
            "metric": mapping.metric,
            "mode": mode,
            "l3_mapping": fields_for_meta,
            "x_field": mapping.x_field,
            "total_field": mapping.total_field,
            "systematic_field": mapping.systematic_field,
        },
    )
    return fig


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
