"""SnapshotPage — the layout engine for one 11×8.5 landscape PDF page.

Usage
-----
>>> page = SnapshotPage(
...     title="NVDA — NVIDIA Corp",
...     subtitle="R1 · Factor Risk Profile",
...     ticker="NVDA",
...     teo="2026-04-02",
...     chips=[("Mkt β", "1.32"), ("Vol 23d", "42.1%"), ...],
... )
>>> ax_a = page.panel(row_slice=slice(2, 7), col_slice=slice(0, 6))
>>> chart_hbar(ax_a, ...)
>>> page.save("output/NVDA_R1.pdf")

Every page gets: header bar, metric chips row, footer strip.
Callers request panel axes via ``page.panel()`` using GridSpec slices.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Sequence

import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.figure import Figure
from matplotlib.axes import Axes

from ._theme import THEME


class SnapshotPage:
    """One landscape letter page with institutional header, chips, and footer.

    Parameters
    ----------
    title       : Main header text (e.g. "NVDA — NVIDIA Corporation").
    subtitle    : Right-aligned subheader (e.g. "R1 · Factor Risk Profile").
    ticker      : Ticker string for branding.
    teo         : Data as-of date string.
    chips       : List of (label, value) tuples rendered as metric chips.
    grid_rows   : GridSpec rows (default 12).
    grid_cols   : GridSpec cols (default 12).
    """

    fig: Figure
    gs: gridspec.GridSpec

    def __init__(
        self,
        title: str,
        subtitle: str,
        ticker: str = "",
        teo: str = "",
        chips: Sequence[tuple[str, str]] | None = None,
        *,
        grid_rows: int | None = None,
        grid_cols: int | None = None,
    ) -> None:
        layout = THEME.layout
        THEME.apply_globally()

        rows = grid_rows or layout.grid_rows
        cols = grid_cols or layout.grid_cols

        self.fig = plt.figure(
            figsize=(layout.page_w, layout.page_h),
            facecolor=THEME.palette.fig_bg,
        )

        self.gs = self.fig.add_gridspec(
            rows, cols,
            left=layout.left,
            right=layout.right,
            top=layout.top,
            bottom=layout.bottom,
            hspace=layout.hspace,
            wspace=layout.wspace,
        )

        self._title = title
        self._subtitle = subtitle
        self._ticker = ticker
        self._teo = teo
        self._chips = chips or []
        self._rows = rows
        self._cols = cols

        self._render_header()
        if self._chips:
            self._render_chips()
        self._render_footer()

    # ── Public API ─────────────────────────────────────────────────────

    def panel(self, row_slice: slice, col_slice: slice) -> Axes:
        """Return a new Axes occupying the given GridSpec region.

        Example: ``page.panel(slice(2, 7), slice(0, 6))`` → top-left panel
        spanning rows 2–6 and columns 0–5.
        """
        ax = self.fig.add_subplot(self.gs[row_slice, col_slice])
        ax.set_facecolor(THEME.palette.panel_bg)
        return ax

    def save(self, path: str | Path) -> Path:
        """Save to PDF, PNG, or any format Matplotlib supports and close."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        self.fig.savefig(
            str(p),
            dpi=THEME.layout.dpi,
            facecolor=self.fig.get_facecolor(),
        )
        plt.close(self.fig)
        return p

    def to_png_bytes(self, *, dpi: int | None = None) -> bytes:
        """Render the page to PNG bytes in memory (no file I/O).

        Returns raw PNG bytes suitable for HTTP responses, base64 encoding,
        or writing to any file-like object.
        """
        buf = BytesIO()
        self.fig.savefig(
            buf,
            format="png",
            dpi=dpi or THEME.layout.dpi,
            facecolor=self.fig.get_facecolor(),
        )
        plt.close(self.fig)
        return buf.getvalue()

    # ── Header ─────────────────────────────────────────────────────────

    def _render_header(self) -> None:
        pal = THEME.palette
        typ = THEME.type

        # Title — left-aligned, top of page
        self.fig.text(
            0.05, 0.97,
            self._title,
            fontsize=typ.page_title,
            fontweight=typ.weight_bold,
            color=pal.navy,
            va="top", ha="left",
            fontfamily=typ.family,
        )

        # Subtitle — right-aligned
        self.fig.text(
            0.95, 0.97,
            self._subtitle,
            fontsize=typ.panel_title,
            fontweight=typ.weight_normal,
            color=pal.text_mid,
            va="top", ha="right",
            fontfamily=typ.family,
        )

        # Navy header underline
        from matplotlib.lines import Line2D
        line = Line2D(
            [0.05, 0.95], [0.955, 0.955],
            transform=self.fig.transFigure,
            color=pal.navy,
            linewidth=THEME.strokes.header_lw,
            clip_on=False,
        )
        self.fig.add_artist(line)

    # ── Chips (key metrics row) ────────────────────────────────────────

    def _render_chips(self) -> None:
        """Render metric chips as a horizontal row beneath the header."""
        pal = THEME.palette
        typ = THEME.type
        chips = self._chips

        n = len(chips)
        if n == 0:
            return

        # Chip geometry: evenly space across 0.05–0.95 horizontal range
        x_start = 0.05
        x_end = 0.95
        total_width = x_end - x_start
        chip_w = min(total_width / n, 0.11)  # max chip width
        gap = (total_width - chip_w * n) / max(n - 1, 1) if n > 1 else 0
        y_center = 0.925  # just below header line

        for i, (label, value) in enumerate(chips):
            x = x_start + i * (chip_w + gap)
            cx = x + chip_w / 2

            # Chip background rectangle
            from matplotlib.patches import FancyBboxPatch
            rect = FancyBboxPatch(
                (x, y_center - 0.018),
                chip_w, 0.032,
                boxstyle="round,pad=0.003",
                facecolor=pal.chip_bg,
                edgecolor=pal.chip_border,
                linewidth=0.5,
                transform=self.fig.transFigure,
                clip_on=False,
            )
            self.fig.add_artist(rect)

            # Value (bold, Navy)
            self.fig.text(
                cx, y_center + 0.005,
                str(value),
                fontsize=typ.chip_value,
                fontweight=typ.weight_bold,
                color=pal.navy,
                va="center", ha="center",
                fontfamily=typ.family,
                transform=self.fig.transFigure,
            )

            # Label (small, gray)
            self.fig.text(
                cx, y_center - 0.011,
                str(label),
                fontsize=typ.chip_label,
                fontweight=typ.weight_normal,
                color=pal.text_light,
                va="center", ha="center",
                fontfamily=typ.family,
                transform=self.fig.transFigure,
            )

    # ── Footer ─────────────────────────────────────────────────────────

    def _render_footer(self) -> None:
        pal = THEME.palette
        typ = THEME.type

        # Thin top border line for footer
        from matplotlib.lines import Line2D
        line = Line2D(
            [0.05, 0.95], [0.025, 0.025],
            transform=self.fig.transFigure,
            color=pal.border,
            linewidth=THEME.strokes.border_lw,
            clip_on=False,
        )
        self.fig.add_artist(line)

        # Left: product + version
        self.fig.text(
            0.05, 0.012,
            f"ERM3 V3 · riskmodels-py · {self._teo}",
            fontsize=typ.footer,
            color=pal.text_light,
            va="center", ha="left",
            fontfamily=typ.family,
        )

        # Right: disclaimer
        self.fig.text(
            0.95, 0.012,
            "BW Macro · Confidential · Not Investment Advice",
            fontsize=typ.footer,
            color=pal.text_light,
            va="center", ha="right",
            fontfamily=typ.family,
        )
