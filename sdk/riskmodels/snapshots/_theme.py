"""Consultant Navy design system — single source of truth for all snapshot pages.

Every colour, font size, line width, and spacing constant lives here.
Import ``THEME`` and pass values to Matplotlib; never hard-code styling elsewhere.

Palette
-------
Navy / Teal / Subsector / Green / Orange — maps to Market / Sector / Subsector /
Residual / Gross-return across both Risk and Performance suites. The Subsector
swatch is institutional violet (formerly slate); renamed during PR 3 to surface
the semantic role rather than the colour name.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib import font_manager


# ── Palette ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Palette:
    """Consultant Navy colour palette."""

    navy:       str = "#002a5e"
    teal:       str = "#006f8e"
    subsector:  str = "#6d28d9"   # institutional violet (was slate #2a7fbf, renamed PR 3)
    green:      str = "#00AA00"
    orange:     str = "#E07000"

    # Backgrounds
    fig_bg:     str = "#f5f7fb"
    panel_bg:   str = "#ffffff"

    # Neutral / grid
    grid:       str = "#e2e8f0"
    border:     str = "#cbd5e1"
    text_dark:  str = "#1a1a2e"
    text_mid:   str = "#475569"
    text_light: str = "#94a3b8"

    # Chip styling
    chip_bg:    str = "#eef2f7"
    chip_border: str = "#dce3ed"

    # Positive / negative
    pos:        str = "#00AA00"
    neg:        str = "#CC2936"

    # Factor colours (ordered: market, sector, subsector, residual)
    @property
    def factor_colors(self) -> list[str]:
        return [self.navy, self.teal, self.subsector, self.green]

    @property
    def factor_labels(self) -> list[str]:
        return ["Market", "Sector", "Subsector", "Residual"]

    # Extended series palette (for multi-line / multi-bar charts)
    @property
    def series(self) -> list[str]:
        return [self.navy, self.teal, self.subsector, self.green, self.orange,
                "#7c3aed", "#d946ef", "#06b6d4"]


# ── Typography ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Typography:
    """Font sizes and families.

    Charter (bold) sets headlines, Inter sets everything analytical; the
    role -> file binding lives in ``_typography``, which is what renderers
    should ask rather than naming a family here.
    """

    family:        str = "Inter"
    family_serif:  str = "Charter"   # headlines — see _typography
    family_fallback: tuple[str, ...] = ("Helvetica Neue", "Arial", "DejaVu Sans")
    family_mono:   str = "Liberation Mono"

    # Sizes (points)
    page_title:    float = 14.0
    panel_title:   float = 11.0
    body:          float = 8.0
    chip_value:    float = 10.0
    chip_label:    float = 7.0
    footer:        float = 7.0
    axis_label:    float = 8.0
    axis_tick:     float = 7.0
    annotation:    float = 7.5
    table_header:  float = 8.0
    table_body:    float = 7.5

    # Weights
    weight_bold:   str = "bold"
    weight_normal: str = "normal"


# ── Layout ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Layout:
    """Page geometry constants."""

    # Page size (landscape letter)
    page_w:     float = 11.0
    page_h:     float = 8.5
    dpi:        int   = 300

    # GridSpec defaults
    grid_rows:  int   = 12
    grid_cols:  int   = 12

    # Margins (fraction of figure)
    left:       float = 0.06
    right:      float = 0.95
    top:        float = 0.90
    bottom:     float = 0.08

    # Spacing between panels (fraction)
    hspace:     float = 0.65
    wspace:     float = 0.30

    # Header / footer heights (in grid rows)
    header_rows: int  = 1   # row 0
    chip_rows:   int  = 1   # row 1
    panel_start: int  = 2   # panels begin at row 2
    panel_end:   int  = 12  # panels end at row 12 (footer is annotation)


# ── Line / stroke ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Strokes:
    """Line widths and styles."""

    grid_lw:      float = 0.4
    grid_style:   str   = "--"
    grid_alpha:   float = 0.6

    border_lw:    float = 0.5
    header_lw:    float = 3.0
    series_lw:    float = 1.8
    thin_lw:      float = 1.0
    bar_edge_lw:  float = 0.3

    fill_alpha:   float = 0.25
    bar_alpha:    float = 0.85


# ── Composite theme ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class Theme:
    """Complete design system — the only object importers need."""

    palette:    Palette     = field(default_factory=Palette)
    type:       Typography  = field(default_factory=Typography)
    layout:     Layout      = field(default_factory=Layout)
    strokes:    Strokes     = field(default_factory=Strokes)

    # ── Convenience ────────────────────────────────────────────────

    def apply_globally(self) -> None:
        """Set Matplotlib rcParams so all new figures inherit the theme.

        Also registers bundled Inter font files if they exist in the user
        font directory, so the font is available on any machine without
        requiring a system-level install.
        """
        # ── Register bundled faces + vector-output settings ────────
        # _typography binds each role to an explicit bundled file: naming a
        # family lets whatever the host has installed win, which is how this
        # theme spent its life declaring Inter and drawing DejaVu Sans.
        _register_bundled_fonts()
        rc = mpl.rcParams
        try:
            from ._typography import apply_rcparams as _apply_type
            _apply_type(rc)
        except Exception:  # pragma: no cover - never block a render on fonts
            pass
        rc["figure.facecolor"]  = self.palette.fig_bg
        rc["axes.facecolor"]    = self.palette.panel_bg
        rc["axes.edgecolor"]    = self.palette.border
        rc["axes.labelcolor"]   = self.palette.text_dark
        rc["axes.labelsize"]    = self.type.axis_label
        rc["axes.titlesize"]    = self.type.panel_title
        rc["axes.titleweight"]  = self.type.weight_bold
        rc["axes.grid"]         = True
        rc["axes.grid.which"]   = "major"
        rc["grid.color"]        = self.palette.grid
        rc["grid.linewidth"]    = self.strokes.grid_lw
        rc["grid.linestyle"]    = self.strokes.grid_style
        rc["grid.alpha"]        = self.strokes.grid_alpha
        rc["xtick.labelsize"]   = self.type.axis_tick
        rc["ytick.labelsize"]   = self.type.axis_tick
        rc["xtick.color"]       = self.palette.text_mid
        rc["ytick.color"]       = self.palette.text_mid
        rc["font.size"]         = self.type.body
        rc["legend.fontsize"]   = self.type.axis_tick
        rc["legend.frameon"]    = False
        rc["figure.dpi"]        = 100   # screen preview; savefig uses layout.dpi

    def format_pct(self, v: float | None, decimals: int = 1, plus: bool = True) -> str:
        """Format a decimal return as a percentage string.  0.05 → '+5.0%'."""
        if v is None:
            return "—"
        s = f"{v * 100:.{decimals}f}%"
        if plus and v > 0:
            s = "+" + s
        return s

    def format_number(self, v: float | None, decimals: int = 2, prefix: str = "") -> str:
        """General number formatter with optional prefix (e.g. '$')."""
        if v is None:
            return "—"
        return f"{prefix}{v:,.{decimals}f}"

    def pct_color(self, v: float | None) -> str:
        """Return green for positive, red for negative, mid-gray for None."""
        if v is None:
            return self.palette.text_mid
        return self.palette.pos if v >= 0 else self.palette.neg


# ── Font registration ──────────────────────────────────────────────────────

_FONTS_REGISTERED = False


def _register_bundled_fonts() -> None:
    """Register Inter font files from common locations.

    Called once by ``THEME.apply_globally()``. Checks:
    1. User font dir (~/.local/share/fonts/)
    2. Bundled with the SDK (sdk/riskmodels/snapshots/fonts/)
    3. System font dirs

    Safe to call multiple times; registers only once.
    """
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    _FONTS_REGISTERED = True

    import glob
    import os

    search_dirs = [
        os.path.join(os.path.dirname(__file__), "fonts"),   # shipped with the SDK
        os.path.expanduser("~/Library/Fonts"),              # macOS user install
        os.path.expanduser("~/.local/share/fonts"),
        "/usr/share/fonts/truetype/inter",
    ]

    # Both extensions and both families: the shipped faces are .otf, and the
    # previous glob (``Inter-*.ttf``) matched none of them — so "bundled
    # Inter" registered nothing even on a machine that had it.
    patterns = ("Inter-*.otf", "Inter-*.ttf", "InterTabular-*.otf", "Charter*.otf")
    for d in search_dirs:
        for pattern in patterns:
            for f in glob.glob(os.path.join(d, pattern)):
                try:
                    font_manager.fontManager.addfont(f)
                except Exception:
                    pass


# ── Module-level singleton ─────────────────────────────────────────────────

THEME = Theme()
"""Import this in every snapshot module:  ``from ._theme import THEME``"""
