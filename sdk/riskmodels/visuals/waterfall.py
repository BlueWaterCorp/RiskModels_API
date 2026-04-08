"""Horizontal waterfall chart showing step-by-step variance decomposition.

Shows how total portfolio variance is built from:
Market -> Sector -> Subsector -> Residual = Total

Each bar starts where the previous one ended (classic waterfall), making it
visually clear how much each factor layer contributes to total risk.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pandas as pd

from ..lineage import RiskLineage
from .components.variance_waterfall import (
    VarianceWaterfallData,
    build_variance_waterfall_data,
    plot_variance_waterfall_from_data,
)


def plot_variance_waterfall(
    per_ticker: pd.DataFrame,
    weights: Mapping[str, float],
    *,
    sigma_scaled: bool = True,
    metadata: Mapping[str, Any] | None = None,
    lineage: RiskLineage | None = None,
) -> Any:
    """Portfolio-level L3 variance waterfall.

    Parameters
    ----------
    per_ticker : pd.DataFrame
        Per-ticker metrics (index = ticker), as from ``PortfolioAnalysis.per_ticker``.
    weights : Mapping[str, float]
        Portfolio weights (should sum to ~1).
    sigma_scaled : bool
        If True, segments are sigma x ER share (annualized vol contribution).
        If False, segments are pure variance fractions (sum to 1).
    metadata : Mapping | None
        Optional metadata dict for title subtitle (``teo``, ``model_version``).
    lineage : RiskLineage | None
        Data lineage for footnote.
    """
    if per_ticker.empty:
        try:
            import plotly.graph_objects as go
        except ImportError as e:  # pragma: no cover
            raise ImportError("Plotting requires: pip install riskmodels-py[viz]") from e
        return go.Figure()

    data = build_variance_waterfall_data(
        per_ticker, weights, sigma_scaled=sigma_scaled, metadata=metadata, lineage=lineage,
    )
    return plot_variance_waterfall_from_data(data)
