"""RiskModels plot themes, palettes, and named presets.

All color constants -- Plotly publication palette, terminal dark, README dark, and
GitHub-flavored contrast palettes -- live here so both Plotly-based visuals and
Matplotlib-based ``visual_refinement`` charts share a single source of truth.
"""

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

# ---------------------------------------------------------------------------
# Publication palette (aligned with article visuals / portal / Plotly charts)
# ---------------------------------------------------------------------------
L3_MARKET = "#3b82f6"
L3_SECTOR = "#06b6d4"
L3_SUBSECTOR = "#f97316"
L3_RESIDUAL = "#94a3b8"
TITLE_SLATE = "#475569"
TITLE_DEEP = "#1a365d"

# ---------------------------------------------------------------------------
# Plotly "Terminal Dark" (parity with RM_ORG demos/article_visuals.py)
# ---------------------------------------------------------------------------
TERMINAL_BG = "#141520"
TERMINAL_CARD = "#252740"
TERMINAL_FG = "#e4e5ec"
TERMINAL_MUTED = "#9ea1b0"
TERMINAL_BORDER = "#4a4c66"

# ---------------------------------------------------------------------------
# GitHub-flavored contrast (README light/dark backgrounds) -- Matplotlib charts
# ---------------------------------------------------------------------------
GITHUB_LIGHT: dict[str, str] = {
    "canvas": "#f6f8fa",
    "fg": "#24292f",
    "muted": "#6e7781",
    "green": "#1a7f37",
    "red": "#cf222e",
}
GITHUB_DARK: dict[str, str] = {
    "canvas": "#0d1117",
    "fg": "#e6edf3",
    "muted": "#8b949e",
    "green": "#3fb950",
    "red": "#f85149",
}

# README / GitHub dark-mode embeds: high-contrast, matches github.com dark UI (#0d1117).
# Used by save_ranking_chart, save_ranking_percentile_bar_chart, save_macro_sensitivity_matrix,
# and save_risk_intel_inspiration_figure in visual_refinement.py.
README_DARK: dict[str, str] = {
    "canvas": "#0d1117",
    "surface": "#161b22",
    "fg": "#e6edf3",
    "muted": "#8b949e",
    "hill_fill": "#238636",
    "hill_line": "#3fb950",
    "needle": "#58a6ff",
    "cell_edge": "#30363d",
    "bar_muted_line": "#484f58",
    "accent_purple": "#8957e5",
    "accent_blue": "#58a6ff",
    "accent_green": "#3fb950",
    "positive": "#3fb950",
    "negative": "#f85149",
    "brand": "#79c0ff",
}

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
        "description": "Horizontal stacked L3 risk (sigma-scalable) for one or many tickers.",
    },
    "risk_cascade": {
        "colors": L3_LAYER_COLORS,
        "description": "Variable-width stacked L3 explained risk for weighted holdings.",
    },
    "attribution_cascade": {
        "colors": L3_LAYER_COLORS,
        "description": "Same x-axis as risk_cascade; return contribution proxy (v1, documented).",
    },
    "cumulative_returns_with_drawdown": {"description": "Stub -- not implemented yet."},
    "variance_waterfall": {"description": "Stub -- not implemented yet."},
    "hedge_ratio_heatmap": {"description": "Stub -- not implemented yet."},
    "pri_benchmark_comparison": {"description": "Stub -- not implemented yet."},
}


def get_preset(name: PresetName) -> dict[str, Any]:
    return dict(PRESET_REGISTRY.get(name, {}))
