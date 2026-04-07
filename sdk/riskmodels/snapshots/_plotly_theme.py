"""Plotly design system — single source of truth for all new snapshot pages.

Replaces the Matplotlib-based _theme.py for all new R/P snapshots.
Legacy S1/S2 (WeasyPrint) continue to use _theme.py until retired.

Design Principles
-----------------
- Tufte-style minimalism: no chart junk, direct labeling, minimal ink
- Professional sans-serif typography (Inter → Roboto → Helvetica)
- G10 continuous color scale, Prism discrete palette
- Zero unnecessary whitespace (tight margins for snapshot composition)
- plotly_white base template with all defaults overridden

Usage
-----
    from ._plotly_theme import PLOTLY_THEME, apply_theme

    # Apply globally (call once at module/script entry):
    apply_theme()

    # Use in any figure:
    fig = px.bar(df, x="factor", y="value")
    PLOTLY_THEME.style(fig)          # apply full design system
    PLOTLY_THEME.style(fig, tight=False)  # keep default Plotly margins

    # Access palette, fonts, etc.:
    PLOTLY_THEME.palette.navy
    PLOTLY_THEME.palette.factor_colors
    PLOTLY_THEME.fonts.family
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import plotly.io as pio
import plotly.graph_objects as go
import plotly.express as px


# ── Color Palettes ───────────────────────────────────────────────────────────

# Plotly built-in references
G10 = px.colors.qualitative.G10
PRISM = px.colors.qualitative.Prism

@dataclass(frozen=True)
class Palette:
    """Color palette — semantic names mapped to hex values.

    Factor colors follow the Risk suite convention:
    Market → Sector → Subsector → Residual.
    """

    # Primary brand
    navy:       str = "#002a5e"
    teal:       str = "#006f8e"
    slate:      str = "#2a7fbf"

    # Signal colors
    green:      str = "#00AA00"
    orange:     str = "#E07000"
    red:        str = "#CC2936"

    # Backgrounds (Tufte: near-white, no distraction)
    fig_bg:     str = "rgba(0,0,0,0)"   # transparent figure background
    plot_bg:    str = "rgba(0,0,0,0)"   # transparent plot area
    paper_bg:   str = "#ffffff"          # white paper for export

    # Neutral / structural
    axis_line:  str = "#EEEEEE"          # faint gray axis lines
    grid:       str = "#EEEEEE"          # (disabled by default, available if needed)
    border:     str = "#cbd5e1"
    text_dark:  str = "#1a1a2e"
    text_mid:   str = "#475569"
    text_light: str = "#94a3b8"

    # Positive / negative
    pos:        str = "#00AA00"
    neg:        str = "#CC2936"

    # Discrete color sequence (Prism) — for categorical / multi-series
    @property
    def discrete(self) -> list[str]:
        return list(PRISM)

    # Continuous color scale (G10) — for sequential / gradient
    @property
    def continuous(self) -> list[str]:
        return list(G10)

    # Factor colors (ordered: market, sector, subsector, residual)
    @property
    def factor_colors(self) -> list[str]:
        return [self.navy, self.teal, self.slate, self.green]

    @property
    def factor_labels(self) -> list[str]:
        return ["Market", "Sector", "Subsector", "Residual"]

    # Extended series palette (Prism-based, branded)
    @property
    def series(self) -> list[str]:
        return [self.navy, self.teal, self.slate, self.green, self.orange,
                "#7c3aed", "#d946ef", "#06b6d4", *PRISM[8:]]


# ── Typography ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Fonts:
    """Professional sans-serif typography stack."""

    family:     str = "Inter, Roboto, Helvetica, Arial, sans-serif"
    family_mono: str = "JetBrains Mono, Fira Code, monospace"

    # Sizes (px for Plotly)
    page_title:   int = 18
    panel_title:  int = 14
    body:         int = 11
    axis_label:   int = 11
    axis_tick:    int = 10
    annotation:   int = 10
    table_header: int = 11
    table_body:   int = 10
    footer:       int = 9


# ── Layout ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class LayoutConfig:
    """Page geometry for snapshot composition."""

    # Landscape letter (pixels at 96 DPI for screen; 300 DPI for export)
    page_w:     int = 1056    # 11in × 96dpi
    page_h:     int = 816     # 8.5in × 96dpi
    export_dpi: int = 300
    export_scale: int = 3     # scale factor for high-res PNG export

    # Zero-margin default (for snapshot composition)
    margin_t:   int = 0
    margin_b:   int = 0
    margin_l:   int = 0
    margin_r:   int = 0
    pad:        int = 0

    @property
    def zero_margin(self) -> dict[str, int]:
        return dict(t=self.margin_t, b=self.margin_b,
                    l=self.margin_l, r=self.margin_r, pad=self.pad)


# ── Composite Theme ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PlotlyTheme:
    """Complete Plotly design system — the only object importers need."""

    palette: Palette       = field(default_factory=Palette)
    fonts:   Fonts         = field(default_factory=Fonts)
    layout:  LayoutConfig  = field(default_factory=LayoutConfig)

    def base_layout(self, *, tight: bool = True) -> dict[str, Any]:
        """Return a layout dict encoding the full design system.

        Parameters
        ----------
        tight : If True (default), applies zero margins for snapshot
                composition. Set False for standalone / interactive charts.
        """
        pal = self.palette
        fonts = self.fonts
        lyt = self.layout

        layout: dict[str, Any] = {
            # Paper & plot background (transparent for composition)
            "paper_bgcolor": pal.fig_bg,
            "plot_bgcolor": pal.plot_bg,

            # Typography
            "font": {
                "family": fonts.family,
                "size": fonts.body,
                "color": pal.text_dark,
            },
            "title": {
                "font": {
                    "family": fonts.family,
                    "size": fonts.panel_title,
                    "color": pal.navy,
                },
                "x": 0,
                "xanchor": "left",
            },

            # Tufte axes — faint lines, no gridlines, no top/right spines
            "xaxis": self._axis_config(),
            "yaxis": self._axis_config(),

            # Legend — no frame, positioned outside chart area
            "legend": {
                "bgcolor": "rgba(0,0,0,0)",
                "borderwidth": 0,
                "font": {
                    "family": fonts.family,
                    "size": fonts.axis_tick,
                    "color": pal.text_mid,
                },
            },

            # Color sequences
            "colorway": pal.discrete,

            # Hover
            "hoverlabel": {
                "bgcolor": pal.navy,
                "font": {
                    "family": fonts.family,
                    "size": fonts.body,
                    "color": "#ffffff",
                },
                "bordercolor": pal.navy,
            },
        }

        if tight:
            layout["margin"] = lyt.zero_margin
        else:
            layout["margin"] = dict(t=40, b=40, l=60, r=20, pad=4)

        return layout

    def _axis_config(self) -> dict[str, Any]:
        """Tufte-style axis: faint line, no grid, no mirror."""
        pal = self.palette
        fonts = self.fonts
        return {
            "showgrid": False,
            "gridcolor": pal.grid,
            "gridwidth": 0.5,
            "zeroline": False,
            "showline": True,
            "linecolor": pal.axis_line,
            "linewidth": 1,
            "mirror": False,          # no top/right spines
            "ticks": "outside",
            "tickcolor": pal.axis_line,
            "tickfont": {
                "family": fonts.family,
                "size": fonts.axis_tick,
                "color": pal.text_mid,
            },
            "title": {
                "font": {
                    "family": fonts.family,
                    "size": fonts.axis_label,
                    "color": pal.text_mid,
                },
            },
        }

    def style(self, fig: go.Figure, *, tight: bool = True) -> go.Figure:
        """Apply the full design system to an existing figure.

        Call this after creating any Plotly figure to enforce consistency.
        Returns the figure for chaining.
        """
        fig.update_layout(**self.base_layout(tight=tight))
        return fig

    def make_template(self) -> go.layout.Template:
        """Build a Plotly template object from this theme.

        Used by ``apply_theme()`` to set the global default.
        """
        template = pio.templates["plotly_white"]
        custom = go.layout.Template(layout=self.base_layout(tight=False))
        # Merge: custom overrides plotly_white
        template.layout.update(custom.layout)
        return template

    # ── Formatters (carried over from Theme) ──────────────────────

    def format_pct(self, v: float | None, decimals: int = 1, plus: bool = True) -> str:
        """Format a decimal as percentage. 0.05 → '+5.0%'."""
        if v is None:
            return "\u2014"
        s = f"{v * 100:.{decimals}f}%"
        if plus and v > 0:
            s = "+" + s
        return s

    def format_number(self, v: float | None, decimals: int = 2, prefix: str = "") -> str:
        """General number formatter with optional prefix."""
        if v is None:
            return "\u2014"
        return f"{prefix}{v:,.{decimals}f}"

    def pct_color(self, v: float | None) -> str:
        """Return green for positive, red for negative, mid-gray for None."""
        if v is None:
            return self.palette.text_mid
        return self.palette.pos if v >= 0 else self.palette.neg


# ── Module singleton ─────────────────────────────────────────────────────────

PLOTLY_THEME = PlotlyTheme()
"""Import this in every new snapshot module: ``from ._plotly_theme import PLOTLY_THEME``"""


def apply_theme() -> None:
    """Set the Plotly global default template to the snapshot design system.

    Call once at module/script entry. After this, every ``px.*`` or ``go.Figure``
    call inherits the design system automatically.

    Also sets the default color sequences to G10 (continuous) and Prism (discrete).
    """
    pio.templates["riskmodels"] = PLOTLY_THEME.make_template()
    pio.templates.default = "riskmodels"

    # Set default color sequences for px
    px.defaults.color_discrete_sequence = PRISM
    px.defaults.color_continuous_scale = G10
