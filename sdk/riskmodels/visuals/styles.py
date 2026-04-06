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
# Consultant Navy — institutional PDF snapshot suite (S1–S4)
# Matches alpha_forensic.py palette in BWMACRO (the reference prototype).
# All snapshot scripts import from here — never hardcode colors.
# ---------------------------------------------------------------------------
CN_NAVY     = "#002a5e"   # primary: titles, headers, borders, market bars
CN_TEAL     = "#006f8e"   # secondary: sector bars, annotations
CN_SLATE    = "#2a7fbf"   # tertiary: subsector bars (matches alpha_forensic.py)
CN_GREEN    = "#00AA00"   # alpha/positive: residual ER, selection spread
CN_ORANGE   = "#E07000"   # warning/negative: returns, risk highlights
CN_GRAY     = "#888888"   # gridlines, minor labels
CN_LIGHT_BG = "#f5f7fb"   # page background

CONSULTANT_NAVY: dict[str, str] = {
    "primary":    CN_NAVY,
    "secondary":  CN_TEAL,
    "slate":      CN_SLATE,
    "alpha":      CN_GREEN,
    "warning":    CN_ORANGE,
    "gray":       CN_GRAY,
    "light_bg":   CN_LIGHT_BG,
}

# L3 factor bar colors in Consultant Navy context (overrides publication palette for PDFs)
CN_L3_LAYER_COLORS: dict[str, str] = {
    "market":    CN_NAVY,
    "sector":    CN_TEAL,
    "subsector": CN_SLATE,
    "residual":  CN_GREEN,
}

PDF_LAYOUT: dict[str, str | int] = {
    "size":          "letter landscape",   # 11 × 8.5 in
    "dpi":           300,
    "engine":        "weasyprint",
    "chart_engine":  "matplotlib",
    "margin_in":     "0.45in",
}

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
    "variance_waterfall": {
        "colors": L3_LAYER_COLORS,
        "description": "Horizontal waterfall: Market → Sector → Subsector → Residual = Total σ.",
    },
    "hedge_ratio_heatmap": {"description": "Stub -- not implemented yet."},
    "pri_benchmark_comparison": {"description": "Stub -- not implemented yet."},
}


def get_preset(name: PresetName) -> dict[str, Any]:
    return dict(PRESET_REGISTRY.get(name, {}))


# ---------------------------------------------------------------------------
# Global Plotly template — ensures every chart rendered via the SDK has
# consistent typography, grid styling, and brand identity.
# ---------------------------------------------------------------------------
def get_rm_template() -> Any:
    """Return a Plotly layout template with RiskModels brand defaults.

    Call ``install_rm_template()`` once at session start to register and
    activate it globally.
    """
    try:
        import plotly.graph_objects as go  # type: ignore[import-untyped]
    except ImportError:
        raise ImportError(
            "Plotly is required for the RiskModels template. "
            "Install it with: pip install riskmodels-py[viz]"
        )

    template = go.layout.Template()
    template.layout = go.Layout(
        font=dict(
            family="Inter, system-ui, -apple-system, sans-serif",
            size=12,
            color="#1e293b",
        ),
        paper_bgcolor="white",
        plot_bgcolor="#f8fafc",
        title_font=dict(size=18, color=TITLE_DEEP),
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
            font=dict(size=11),
        ),
        xaxis=dict(
            gridcolor="#e2e8f0",
            zerolinecolor="#94a3b8",
            title_font=dict(size=12, color=TITLE_SLATE),
        ),
        yaxis=dict(
            gridcolor="#e2e8f0",
            zerolinecolor="#94a3b8",
            title_font=dict(size=12, color=TITLE_SLATE),
        ),
        colorway=[L3_MARKET, L3_SECTOR, L3_SUBSECTOR, L3_RESIDUAL],
        margin=dict(l=60, r=40, t=60, b=50),
    )
    return template


def install_rm_template() -> None:
    """Register the ``riskmodels`` Plotly template and set it as the default."""
    try:
        import plotly.io as pio  # type: ignore[import-untyped]
    except ImportError:
        return  # silently skip if Plotly not installed
    pio.templates["riskmodels"] = get_rm_template()
    pio.templates.default = "riskmodels"
