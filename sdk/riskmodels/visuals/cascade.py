"""Variable-width portfolio cascade plots (risk + attribution proxy).

Adapter module: delegates to component dataclasses in ``components/``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

import pandas as pd

from ..lineage import RiskLineage
from .components.attribution_cascade import (
    AttributionCascadeData,
    build_attribution_cascade_data,
    plot_attribution_cascade_from_data,
)
from .components.risk_cascade import (
    RiskCascadeData,
    build_risk_cascade_data,
    plot_risk_cascade_from_data,
)

SortKey = Literal["weight", "risk_contribution"]


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
    if per_ticker.empty:
        try:
            import plotly.graph_objects as go
        except ImportError as e:  # pragma: no cover
            raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
        return go.Figure()

    data = build_risk_cascade_data(
        per_ticker, weights,
        sort_by=sort_by,
        include_systematic_labels=include_systematic_labels,
        metadata=metadata,
        lineage=lineage,
    )
    return plot_risk_cascade_from_data(data)


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
    if returns_long.empty or per_ticker_snapshot.empty:
        try:
            import plotly.graph_objects as go
        except ImportError as e:  # pragma: no cover
            raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
        return go.Figure()

    col = "returns_gross" if "returns_gross" in returns_long.columns else (
        "gross_return" if "gross_return" in returns_long.columns else None
    )
    if col is None:
        try:
            import plotly.graph_objects as go
        except ImportError as e:  # pragma: no cover
            raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
        return go.Figure()

    data = build_attribution_cascade_data(
        returns_long, weights, per_ticker_snapshot,
        sort_by=sort_by,
        metadata=metadata,
        lineage=lineage,
    )
    return plot_attribution_cascade_from_data(data)
