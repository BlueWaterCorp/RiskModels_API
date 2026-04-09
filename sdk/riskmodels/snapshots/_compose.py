"""Pixel-precise page compositor for snapshot PDFs/PNGs.

Each chart is rendered as a standalone Plotly figure → PNG bytes.
The compositor places them onto a white canvas with exact pixel positions,
then overlays text (headers, insights, chips, footer) via Pillow.

This eliminates all Plotly annotation coordinate guessing and gives
absolute control over layout — the same approach used by production
report generators (Bloomberg PORT, FactSet, MSCI).

Usage
-----
    page = SnapshotComposer(width=3300, height=2550)  # 11×8.5in @ 300dpi
    page.text(x, y, "Title", font_size=48, bold=True, color=NAVY)
    page.hline(y, color=NAVY, thickness=6)
    page.paste_figure(fig, x, y, w, h)
    page.rect(x, y, w, h, fill="#f0f4f8")
    page.save("output.png")
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any, Sequence

import plotly.graph_objects as go
from PIL import Image, ImageDraw, ImageFont

from ._plotly_theme import PLOTLY_THEME

T = PLOTLY_THEME

# ── Font resolution ──────────────────────────────────────────────────────

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

# Preferred fonts in order — first available wins
_FONT_NAMES_REGULAR = ["Inter-Regular", "Helvetica", "Arial"]
_FONT_NAMES_BOLD = ["Inter-Bold", "Helvetica-Bold", "Arial Bold", "Helvetica"]
_FONT_NAMES_ITALIC = ["Inter-Italic", "Helvetica-Oblique", "Arial Italic", "Helvetica"]

_RESOLVED_REGULAR: str | None = None
_RESOLVED_BOLD: str | None = None
_RESOLVED_ITALIC: str | None = None


def _resolve_font(names: list[str]) -> str:
    """Find the first available font name."""
    for name in names:
        try:
            ImageFont.truetype(name, 12)
            return name
        except (OSError, IOError):
            continue
    return "Arial"  # ultimate fallback


def _font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
    """Get a cached font at the given size."""
    global _RESOLVED_REGULAR, _RESOLVED_BOLD, _RESOLVED_ITALIC

    if bold:
        if _RESOLVED_BOLD is None:
            _RESOLVED_BOLD = _resolve_font(_FONT_NAMES_BOLD)
        name = _RESOLVED_BOLD
    elif italic:
        if _RESOLVED_ITALIC is None:
            _RESOLVED_ITALIC = _resolve_font(_FONT_NAMES_ITALIC)
        name = _RESOLVED_ITALIC
    else:
        if _RESOLVED_REGULAR is None:
            _RESOLVED_REGULAR = _resolve_font(_FONT_NAMES_REGULAR)
        name = _RESOLVED_REGULAR

    key = (name, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(name, size)
    return _FONT_CACHE[key]


# ── Color helpers ────────────────────────────────────────────────────────

def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


NAVY = _hex_to_rgb(T.palette.navy)
TEAL = _hex_to_rgb(T.palette.teal)
TEXT_DARK = _hex_to_rgb(T.palette.text_dark)
TEXT_MID = _hex_to_rgb(T.palette.text_mid)
TEXT_LIGHT = _hex_to_rgb(T.palette.text_light)
WHITE = (255, 255, 255)
LIGHT_BG = _hex_to_rgb("#f0f4f8")
BORDER = _hex_to_rgb(T.palette.axis_line)


# ── Composer ─────────────────────────────────────────────────────────────

class SnapshotComposer:
    """Pixel-precise page layout engine.

    All coordinates are in pixels. For 300 DPI output:
    - 11×8.5 inch landscape = 3300×2550 px
    - 1 inch = 300 px

    Typical workflow:
        page = SnapshotComposer()
        page.text(...)           # headers, labels, narratives
        page.hline(...)          # dividers
        page.rect(...)           # background boxes
        page.paste_figure(...)   # Plotly charts rendered to PNG
        page.save("out.png")
    """

    def __init__(
        self,
        width: int = 3300,
        height: int = 2550,
        bg: str = "#ffffff",
        dpi: int = 300,
    ):
        self.width = width
        self.height = height
        self.dpi = dpi
        self.img = Image.new("RGB", (width, height), _hex_to_rgb(bg))
        self.draw = ImageDraw.Draw(self.img)

    # ── Text ────────────────────────────────────────────────────────

    def text(
        self,
        x: int,
        y: int,
        text: str,
        *,
        font_size: int = 30,
        color: tuple[int, int, int] = TEXT_DARK,
        bold: bool = False,
        italic: bool = False,
        max_width: int | None = None,
    ) -> int:
        """Draw text at (x, y). Returns the y position after the text.

        If max_width is set, wraps text to fit within that pixel width.
        """
        fnt = _font(font_size, bold=bold, italic=italic)

        if max_width:
            lines = _wrap_text(text, fnt, max_width)
        else:
            lines = [text]

        for line in lines:
            self.draw.text((x, y), line, fill=color, font=fnt)
            y += int(font_size * 1.4)

        return y

    def text_right(
        self,
        x_right: int,
        y: int,
        text: str,
        *,
        font_size: int = 30,
        color: tuple[int, int, int] = TEXT_DARK,
        bold: bool = False,
    ) -> None:
        """Draw right-aligned text ending at x_right."""
        fnt = _font(font_size, bold=bold)
        bbox = fnt.getbbox(text)
        tw = bbox[2] - bbox[0]
        self.draw.text((x_right - tw, y), text, fill=color, font=fnt)

    def text_center(
        self,
        y: int,
        text: str,
        *,
        font_size: int = 30,
        color: tuple[int, int, int] = TEXT_DARK,
        bold: bool = False,
    ) -> None:
        """Draw horizontally centered text."""
        fnt = _font(font_size, bold=bold)
        bbox = fnt.getbbox(text)
        tw = bbox[2] - bbox[0]
        self.draw.text(((self.width - tw) // 2, y), text, fill=color, font=fnt)

    # ── Shapes ──────────────────────────────────────────────────────

    def hline(
        self,
        y: int,
        *,
        x0: int = 0,
        x1: int | None = None,
        color: tuple[int, int, int] = NAVY,
        thickness: int = 6,
    ) -> None:
        """Draw a horizontal line across the page."""
        x1 = x1 or self.width
        self.draw.rectangle([x0, y, x1, y + thickness], fill=color)

    def rect(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        *,
        fill: tuple[int, int, int] = LIGHT_BG,
        outline: tuple[int, int, int] | None = None,
        outline_width: int = 1,
    ) -> None:
        """Draw a filled rectangle."""
        self.draw.rectangle(
            [x, y, x + w, y + h],
            fill=fill,
            outline=outline,
            width=outline_width if outline else 0,
        )

    # ── Figure pasting ──────────────────────────────────────────────

    def paste_figure(
        self,
        fig: go.Figure,
        x: int,
        y: int,
        w: int,
        h: int,
        *,
        scale: int = 2,
        margin: dict[str, Any] | None = None,
    ) -> None:
        """Render a Plotly figure to PNG and paste it at (x, y) with size (w, h).

        The figure is rendered at `scale`x resolution then downsampled
        for crisp output at the target DPI.

        ``margin`` merges into the default Plotly margins (use a larger
        ``r`` when marker text sits to the right of points — Kaleido otherwise
        clips labels in tight layouts).
        """
        mrg: dict[str, Any] = dict(t=5, b=5, l=5, r=5, pad=0)
        if margin:
            mrg.update(margin)
        # Set figure size to match target pixel dimensions / scale
        fig.update_layout(
            width=w // scale,
            height=h // scale,
            margin=mrg,
            paper_bgcolor="#ffffff",
            plot_bgcolor="#ffffff",
        )

        png_bytes = fig.to_image(
            format="png",
            scale=scale,
            engine="kaleido",
        )

        chart_img = Image.open(BytesIO(png_bytes)).convert("RGB")
        # Resize to exact target dimensions
        if chart_img.size != (w, h):
            chart_img = chart_img.resize((w, h), Image.LANCZOS)

        self.img.paste(chart_img, (x, y))

    def paste_image(
        self,
        img: Image.Image,
        x: int,
        y: int,
        w: int | None = None,
        h: int | None = None,
    ) -> None:
        """Paste a PIL Image at (x, y), optionally resizing."""
        if w and h and img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        self.img.paste(img, (x, y))

    # ── Export ──────────────────────────────────────────────────────

    def save(self, path: str | Path) -> Path:
        """Save the composed page to PNG or PDF."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)

        if p.suffix.lower() == ".pdf":
            self.img.save(str(p), "PDF", resolution=self.dpi)
        else:
            self.img.save(str(p), "PNG", dpi=(self.dpi, self.dpi))

        return p

    def to_png_bytes(self) -> bytes:
        """Return PNG bytes (for API responses)."""
        buf = BytesIO()
        self.img.save(buf, "PNG", dpi=(self.dpi, self.dpi))
        return buf.getvalue()


# ── Text wrapping helper ─────────────────────────────────────────────────

def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Word-wrap text to fit within max_width pixels."""
    words = text.split()
    lines: list[str] = []
    current = ""

    for word in words:
        test = f"{current} {word}".strip()
        bbox = font.getbbox(test)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines or [""]
