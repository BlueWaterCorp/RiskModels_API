"""Reusable visual component dataclasses, builders, and renderers.

Each component follows the pattern: dataclass + ``build_*_data()`` + ``plot_*_from_data()``.
"""

from ._types import (
    AttributionPosition,
    CascadePosition,
    L3LayerValues,
    L3TickerRow,
    WaterfallLayer,
)
from .attribution_cascade import (
    AttributionCascadeData,
    build_attribution_cascade_data,
    plot_attribution_cascade_from_data,
)
from .l3_decomposition import (
    L3DecompositionData,
    build_l3_decomposition_data,
    plot_l3_decomposition_from_data,
)
from .risk_cascade import (
    RiskCascadeData,
    build_risk_cascade_data,
    plot_risk_cascade_from_data,
)
from .variance_waterfall import (
    VarianceWaterfallData,
    build_variance_waterfall_data,
    plot_variance_waterfall_from_data,
)

__all__ = [
    # Types
    "AttributionPosition",
    "CascadePosition",
    "L3LayerValues",
    "L3TickerRow",
    "WaterfallLayer",
    # Variance waterfall
    "VarianceWaterfallData",
    "build_variance_waterfall_data",
    "plot_variance_waterfall_from_data",
    # Risk cascade
    "RiskCascadeData",
    "build_risk_cascade_data",
    "plot_risk_cascade_from_data",
    # Attribution cascade
    "AttributionCascadeData",
    "build_attribution_cascade_data",
    "plot_attribution_cascade_from_data",
    # L3 decomposition
    "L3DecompositionData",
    "build_l3_decomposition_data",
    "plot_l3_decomposition_from_data",
]
