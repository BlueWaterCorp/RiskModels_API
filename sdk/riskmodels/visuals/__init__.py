"""Publication-style Plotly/Matplotlib charts for ERM3.

Public visuals: cascade, l3_decomposition, waterfall, components, save, styles, utils.
Curated Mag7 demos and the gallery moved to BWMACRO during PR 3 (2026-05) — only the
generic primitives stay public.
"""

from .cascade import plot_attribution_cascade, plot_risk_cascade
from .components import (
    AttributionCascadeData,
    AttributionPosition,
    CascadePosition,
    L3DecompositionData,
    L3LayerValues,
    L3TickerRow,
    RiskCascadeData,
    VarianceWaterfallData,
    WaterfallLayer,
    build_attribution_cascade_data,
    build_l3_decomposition_data,
    build_risk_cascade_data,
    build_variance_waterfall_data,
    plot_attribution_cascade_from_data,
    plot_l3_decomposition_from_data,
    plot_risk_cascade_from_data,
    plot_variance_waterfall_from_data,
)
from .l3_decomposition import (
    L3_API_FIELD_MAPPINGS,
    L3_API_LAYER_COLORS,
    L3DecompositionMappingError,
    plot_l3_decomposition,
    plot_l3_horizontal,
    plot_l3_year_end_stack,
)
from .save import (
    get_plotly_json,
    save_l3_decomposition_png,
    save_portfolio_attribution_cascade_png,
    save_portfolio_risk_cascade_png,
    write_plotly_png,
)
from .styles import PRESET_REGISTRY, get_preset, get_rm_template, install_rm_template
from .utils import adjacent_bar_positions, cascade_plotly_layout
from .waterfall import plot_variance_waterfall

__all__ = [
    # Component dataclasses & types
    "AttributionCascadeData",
    "AttributionPosition",
    "CascadePosition",
    "L3DecompositionData",
    "L3LayerValues",
    "L3TickerRow",
    "RiskCascadeData",
    "VarianceWaterfallData",
    "WaterfallLayer",
    # Component builders
    "build_attribution_cascade_data",
    "build_l3_decomposition_data",
    "build_risk_cascade_data",
    "build_variance_waterfall_data",
    # Component renderers
    "plot_attribution_cascade_from_data",
    "plot_l3_decomposition_from_data",
    "plot_risk_cascade_from_data",
    "plot_variance_waterfall_from_data",
    # Save helpers
    "adjacent_bar_positions",
    "cascade_plotly_layout",
    "get_plotly_json",
    "get_preset",
    "get_rm_template",
    "install_rm_template",
    # Top-level plotters
    "plot_attribution_cascade",
    "plot_l3_decomposition",
    "plot_l3_horizontal",
    "plot_l3_year_end_stack",
    "plot_risk_cascade",
    "plot_variance_waterfall",
    # Style presets
    "PRESET_REGISTRY",
    # Save
    "save_l3_decomposition_png",
    "save_portfolio_attribution_cascade_png",
    "save_portfolio_risk_cascade_png",
    "write_plotly_png",
    # L3 mapping error
    "L3_API_FIELD_MAPPINGS",
    "L3_API_LAYER_COLORS",
    "L3DecompositionMappingError",
]
