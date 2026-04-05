"""RiskModels plot themes, palettes, and named presets."""

from __future__ import annotations

from typing import Any, Literal

PresetName = Literal[
    "l3_decomposition",
    "risk_cascade",
    "attribution_cascade",
    "cumulative_returns_with_drawdown",
    "variance_waterfall",
    "hedge_ratio_heatmap",
    "pri_benchmark_comparison",
]

# Publication palette (aligned with article visuals / portal)
L3_MARKET = "#3b82f6"
L3_SECTOR = "#06b6d4"
L3_SUBSECTOR = "#f97316"
L3_RESIDUAL = "#94a3b8"
TITLE_SLATE = "#475569"
TITLE_DEEP = "#1a365d"

# Plotly “Terminal Dark” (parity with RM_ORG demos/article_visuals.py)
TERMINAL_BG = "#141520"
TERMINAL_CARD = "#252740"
TERMINAL_FG = "#e4e5ec"
TERMINAL_MUTED = "#9ea1b0"
TERMINAL_BORDER = "#4a4c66"

# Right-rail annotations (matches article visuals / MAG7 reference)
ANNOTATION_FONT: dict[str, Any] = {"size": 11, "color": TITLE_SLATE}

L3_LAYER_COLORS: dict[str, str] = {
    "market": L3_MARKET,
    "sector": L3_SECTOR,
    "subsector": L3_SUBSECTOR,
    "residual": L3_RESIDUAL,
}

PRESET_REGISTRY: dict[str, dict[str, Any]] = {
    "l3_decomposition": {
        "colors": L3_LAYER_COLORS,
        "description": "Horizontal stacked L3 risk (σ-scalable) for one or many tickers.",
    },
    "risk_cascade": {
        "colors": L3_LAYER_COLORS,
        "description": "Variable-width stacked L3 explained risk for weighted holdings.",
    },
    "attribution_cascade": {
        "colors": L3_LAYER_COLORS,
        "description": "Same x-axis as risk_cascade; return contribution proxy (v1, documented).",
    },
    "cumulative_returns_with_drawdown": {"description": "Stub — not implemented yet."},
    "variance_waterfall": {"description": "Stub — not implemented yet."},
    "hedge_ratio_heatmap": {"description": "Stub — not implemented yet."},
    "pri_benchmark_comparison": {"description": "Stub — not implemented yet."},
}


def get_preset(name: PresetName) -> dict[str, Any]:
    return dict(PRESET_REGISTRY.get(name, {}))
