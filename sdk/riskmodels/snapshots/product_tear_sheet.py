"""One-page product tear sheet for riskmodels.app.

Portrait Letter (8.5x11 @ 300 DPI). Static marketing copy + pre-rendered
PNGs from the Medium Part 1 article pipeline. No API calls.

Design: editorial "dossier" system — numbered sections (01..06), oversized
display headline, hairline grid marks, inline-weighted callouts, and a
signature identity bar at the page foot. Consultant Navy palette matches
R1/S1/S2 snapshots but treats the page as a published artifact, not a
dashboard.

Architecture: zone-based. The page is sliced into 7 vertical zones + an
identity strip. Each zone renderer has a HARD height contract.

Usage:
    python -m riskmodels.snapshots.product_tear_sheet
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from PIL import Image

from ._compose import (
    SnapshotComposer,
    NAVY,
    TEAL,
    TEXT_DARK,
    TEXT_MID,
    TEXT_LIGHT,
    WHITE,
    LIGHT_BG,
    BORDER,
    render_portal_riskmodels_brand_logo,
)

# ── Page dimensions (Portrait Letter @ 300 DPI) ────────────────────────
W = 2550
H = 3300
MARGIN = 140
CW = W - 2 * MARGIN  # 2270

# Palette extensions
ACCENT      = (224, 112, 0)         # PALETTE["orange"]
NAVY_INK    = (200, 220, 240)       # muted-white for navy-bg body copy
NAVY_DIM    = (140, 170, 205)       # dimmer navy-ink for tertiary labels
SUBSECTOR_BLUE = (42, 127, 191)
RESIDUAL_GREEN = (0, 140, 70)
HAIRLINE    = (205, 215, 225)       # barely-there rule color
PAPER       = (250, 248, 244)       # warm off-white card (vs clinical grey)

# Zone row budget — orchestrator-controlled.
Z1_HEADER_H      = 150
Z2_HOOK_H        = 380
Z3_PROOF_H       = 500
Z4_DECOMP_H      = 360
Z5_TRADEMAP_H    = 780
Z6_WEDGE_H       = 440
Z7_CTA_H         = 300
GUTTER           = 28
IDENTITY_BAR_H   = 54

# ── Visual asset search paths ──────────────────────────────────────────
_VISUALS_MEDIUM = (
    Path(__file__).resolve().parent.parent.parent.parent
    / ".." / "RM_ORG" / "content" / "Medium" / "visuals"
)
_VISUALS_PART1 = (
    Path(__file__).resolve().parent.parent.parent.parent
    / ".." / "RM_ORG" / "content" / "Medium" / "series" / "Part_1"
)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════
def _fit(src_w: int, src_h: int, max_w: int, max_h: int) -> tuple[int, int]:
    scale = min(max_w / src_w, max_h / src_h)
    return max(1, int(src_w * scale)), max(1, int(src_h * scale))


def _load_visual(
    paths: list[Path], name: str, *,
    crop_top: int = 0, crop_bottom: int = 0,
    crop_left: int = 0, crop_right: int = 0,
) -> Image.Image | None:
    for base in paths:
        p = base / name
        if p.exists():
            img = Image.open(str(p)).convert("RGB")
            w, h = img.size
            if crop_top or crop_bottom or crop_left or crop_right:
                img = img.crop((crop_left, crop_top,
                                w - crop_right, h - crop_bottom))
            return img
    return None


def _paste_fitted(
    page: SnapshotComposer,
    img: Image.Image,
    x: int,
    y: int,
    box_w: int,
    box_h: int,
    *,
    align: str = "center",
) -> None:
    iw, ih = _fit(img.size[0], img.size[1], box_w, box_h)
    px = x + (box_w - iw) // 2 if align == "center" else x
    page.paste_image(img, px, y + (box_h - ih) // 2, iw, ih)


def _section_mark(
    page: SnapshotComposer,
    x: int,
    y: int,
    number: str,
    label: str,
    *,
    color: tuple[int, int, int] = NAVY,
) -> None:
    """Editorial section mark: `[01]  LABEL` with crop-tick on the right.

    Sets the page up as a published artifact rather than a deck slide.
    """
    # Bracketed number — typographic discipline, not a decorative badge
    page.text(x, y, number,
              font_size=20, color=ACCENT, bold=True)
    label_x = x + _text_width(number, 20, True) + 18
    page.text(label_x, y + 2, label,
              font_size=18, color=color, bold=True)
    # Short crop-mark tick at the right edge — architectural, not Excel
    tick_x = x + CW
    page.hline(y + 12, x0=tick_x - 28, x1=tick_x,
               color=NAVY, thickness=2)
    page.rect(tick_x - 2, y + 2, 2, 22, fill=NAVY)


def _text_width(text: str, font_size: int, bold: bool = False) -> int:
    """Approximate text pixel width for layout math."""
    from ._compose import _font as _f
    fnt = _f(font_size, bold=bold)
    bbox = fnt.getbbox(text)
    return int(bbox[2] - bbox[0])


def _corner_ticks(
    page: SnapshotComposer,
    x: int, y: int, w: int, h: int,
    *,
    color: tuple[int, int, int] = HAIRLINE,
    size: int = 14,
    thickness: int = 2,
) -> None:
    """Architectural corner ticks — print-style crop marks, inward facing."""
    # Top-left
    page.hline(y, x0=x, x1=x + size, color=color, thickness=thickness)
    page.rect(x, y, thickness, size, fill=color)
    # Top-right
    page.hline(y, x0=x + w - size, x1=x + w, color=color, thickness=thickness)
    page.rect(x + w - thickness, y, thickness, size, fill=color)
    # Bottom-left
    page.hline(y + h - thickness, x0=x, x1=x + size, color=color, thickness=thickness)
    page.rect(x, y + h - size, thickness, size, fill=color)
    # Bottom-right
    page.hline(y + h - thickness, x0=x + w - size, x1=x + w, color=color, thickness=thickness)
    page.rect(x + w - thickness, y + h - size, thickness, size, fill=color)


# ═══════════════════════════════════════════════════════════════════════
# Zone 1 — Masthead (160px)
# ═══════════════════════════════════════════════════════════════════════
def render_header(page: SnapshotComposer, y: int, _visuals: list[Path]) -> None:
    # Micro-strap above the logo
    page.text(MARGIN, y + 4, "ISSUE 01  \u00b7  SPRING 2026",
              font_size=14, color=ACCENT, bold=True)
    page.text_center(y + 4,
                     "A PRODUCT DOSSIER",
                     font_size=14, color=TEXT_MID, bold=True)
    page.text_right(W - MARGIN, y + 4, "FOR DISCRETIONARY USE",
                    font_size=14, color=TEXT_MID, bold=True)

    # Thick navy rule
    page.hline(y + 32, x0=MARGIN, x1=W - MARGIN, color=NAVY, thickness=3)

    # Logo below rule
    logo = render_portal_riskmodels_brand_logo(max_width=460, max_height=78)
    page.paste_image(logo, MARGIN, y + 56)

    # Right: wordmark URL + tagline beneath
    page.text_right(W - MARGIN, y + 60, "riskmodels.app",
                    font_size=32, color=NAVY, bold=True)
    page.text_right(W - MARGIN, y + 108, "Position-level risk  \u00b7  tradable layers",
                    font_size=15, color=TEXT_MID, bold=True)

    # Bottom hairline terminator
    page.hline(y + Z1_HEADER_H - 4, x0=MARGIN, x1=W - MARGIN,
               color=HAIRLINE, thickness=1)


# ═══════════════════════════════════════════════════════════════════════
# Zone 2 — Hook (340px) — oversized editorial display
# ═══════════════════════════════════════════════════════════════════════
def render_hook(page: SnapshotComposer, y: int, _visuals: list[Path]) -> None:
    # Signature move — MASSIVE edition numeral in the top-right, placed
    # BEHIND the headline with a very light tint. Editorial cover mark.
    page.text(W - MARGIN - 340, y + 40, "01",
              font_size=320, color=(236, 240, 246), bold=True)

    # Issue mark — editorial publication style, below the numeral's upper edge
    page.text(MARGIN, y + 8, "FEATURE 01",
              font_size=15, color=ACCENT, bold=True)
    page.text(MARGIN + 160, y + 8, "\u2014  THE POSITION THESIS",
              font_size=15, color=TEXT_MID, bold=True)

    # Display headline — two-line, dramatic leading, with inline color-shift
    hy = y + 52
    hy = page.text(
        MARGIN, hy,
        "One position.",
        font_size=108, color=NAVY, bold=True, max_width=CW,
    )
    hy -= 24
    hy = page.text(
        MARGIN, hy,
        "Four tradeable bets.",
        font_size=108, color=ACCENT, bold=True, max_width=CW,
    )
    hy += 14

    # Antagonist line — render inline with an explicit color shift
    antag_a = "Most PMs think they bought \u201ctech.\u201d   "
    page.text(MARGIN, hy, antag_a,
              font_size=32, color=TEXT_DARK, bold=True)
    page.text(
        MARGIN + _text_width(antag_a, 32, True) + 18, hy,
        "They didn\u2019t.",
        font_size=32, color=ACCENT, bold=True,
    )

    # Pull quote — right-aligned, far enough below the antagonist to
    # clear the next section's heading when rendered.
    page.text_right(
        W - MARGIN, hy + 62,
        "\u2014  SAME LABEL.  DIFFERENT BET.",
        font_size=17, color=TEAL, bold=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# Zone 3 — Proof: AAPL vs NVDA (500px)
# ═══════════════════════════════════════════════════════════════════════
def render_proof(page: SnapshotComposer, y: int, visuals: list[Path]) -> None:
    _section_mark(page, MARGIN, y + 6, "01", "THE PROOF  \u00b7  AAPL VS NVDA")

    body_y = y + 52
    body_h = Z3_PROOF_H - 60

    split_gap = 28
    left_w = int(CW * 0.58) - split_gap // 2
    right_w = CW - left_w - split_gap
    right_x = MARGIN + left_w + split_gap

    # Left: the table — on a warm paper card. Crop the native title strip
    # off the top so our section mark owns the hierarchy.
    page.rect(MARGIN, body_y, left_w, body_h, fill=PAPER)
    img = _load_visual(visuals, "table_1_aapl_nvda.png", crop_top=140)
    if img is not None:
        _paste_fitted(page, img, MARGIN + 20, body_y + 20,
                      left_w - 40, body_h - 40)
    _corner_ticks(page, MARGIN, body_y, left_w, body_h, size=18, color=NAVY)
    # Caption beneath (editorial)
    page.text(
        MARGIN, body_y + body_h + 6,
        "FIG. 01  \u00b7  Explained-risk contribution by ERM3 layer, trailing year.",
        font_size=14, color=TEXT_LIGHT, bold=True,
    )

    # Right: navy verdict card — typographic hierarchy with oversized data
    page.rect(right_x, body_y, right_w, body_h, fill=NAVY)
    page.rect(right_x, body_y, right_w, 4, fill=ACCENT)

    vy = body_y + 26
    page.text(right_x + 28, vy, "VERDICT",
              font_size=13, color=ACCENT, bold=True)
    page.text_right(right_x + right_w - 28, vy,
                    "TRAILING YEAR",
                    font_size=13, color=NAVY_DIM, bold=True)
    vy += 26
    vy = page.text(
        right_x + 28, vy,
        "Same sector.",
        font_size=30, color=WHITE, bold=True, max_width=right_w - 56,
    )
    vy = page.text(
        right_x + 28, vy,
        "Different bet.",
        font_size=30, color=NAVY_INK, bold=True, italic=True,
        max_width=right_w - 56,
    )
    vy += 24

    # OVERSIZED data marks — signature typographic move.
    # Two rows: big percentage + 2-line decoder (top label + note below).
    data_rows = [
        ("AAPL", "53", "%  IDIOSYNCRATIC",
            "Barely a factor bet \u2014 mostly the name itself.",  WHITE),
        ("NVDA", "22", "%  SECTOR  +  49%  MARKET",
            "A stacked semi + beta trade.",                        ACCENT),
    ]
    available_h = (body_y + body_h) - vy - 50
    row_h_local = available_h // 2
    for ticker, big_num, sub_label, note, accent_c in data_rows:
        # Ticker
        page.text(right_x + 28, vy, ticker,
                  font_size=16, color=accent_c, bold=True)
        # Big numeral
        page.text(right_x + 28, vy + 20, big_num,
                  font_size=88, color=accent_c, bold=True)
        num_w = _text_width(big_num, 88, True)
        # Sub-label beside numeral (upper line)
        page.text(right_x + 28 + num_w + 14, vy + 58, sub_label,
                  font_size=13, color=NAVY_INK, bold=True,
                  max_width=right_w - num_w - 58)
        # Note beneath the numeral's bottom edge (shifted up to avoid overlap)
        page.text(right_x + 28 + num_w + 14, vy + 88, note,
                  font_size=14, color=NAVY_INK, italic=True,
                  max_width=right_w - num_w - 58)
        vy += row_h_local

    # Sign-off at bottom
    page.hline(body_y + body_h - 38, x0=right_x + 28, x1=right_x + right_w - 28,
               color=NAVY_DIM, thickness=1)
    page.text(
        right_x + 28, body_y + body_h - 26,
        "Portfolio tilts won\u2019t tell you this.",
        font_size=13, color=NAVY_INK, italic=True, bold=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# Zone 4 — Decomposition table (360px)
# ═══════════════════════════════════════════════════════════════════════
def render_decomp(page: SnapshotComposer, y: int, _visuals: list[Path]) -> None:
    _section_mark(page, MARGIN, y, "02", "THE DECOMPOSITION  \u00b7  PER POSITION")

    table_y = y + 46
    header_h = 40
    table_avail = Z4_DECOMP_H - (table_y - y) - 6
    row_h = (table_avail - header_h) // 4

    col_num_w   = 100
    col_layer_w = 240
    col_inst_w  = 420
    col_mean_w  = CW - col_num_w - col_layer_w - col_inst_w

    # Header — minimal, navy underline rather than filled band
    page.hline(table_y, x0=MARGIN, x1=MARGIN + CW, color=NAVY, thickness=3)
    page.text(MARGIN + col_num_w + 14, table_y + 12, "LAYER",
              font_size=13, color=TEXT_MID, bold=True)
    page.text(MARGIN + col_num_w + col_layer_w + 14, table_y + 12, "INSTRUMENT",
              font_size=13, color=TEXT_MID, bold=True)
    page.text(MARGIN + col_num_w + col_layer_w + col_inst_w + 14, table_y + 12,
              "WHAT IT MEANS",
              font_size=13, color=TEXT_MID, bold=True)
    page.hline(table_y + header_h, x0=MARGIN, x1=MARGIN + CW,
               color=HAIRLINE, thickness=1)

    rows = [
        ("L1", "Market",    NAVY,           "SPY",
            "Beta you didn\u2019t ask for.",                False),
        ("L2", "Sector",    TEAL,           "XLK  \u00b7  XLE  \u00b7  XLF  \u2026",
            "Broad theme, orthogonal to market.",           False),
        ("L3", "Subsector", SUBSECTOR_BLUE, "SMH  \u00b7  SOXX  \u00b7  KRE  \u2026",
            "The industry bet \u2014 where alpha lives.",   False),
        ("R",  "Residual",  RESIDUAL_GREEN, "\u2014  (alpha)",
            "The bet you actually own.",                    True),
    ]
    ry = table_y + header_h
    for i, (num, layer, color, inst, meaning, highlight) in enumerate(rows):
        # The Residual row gets an editorial highlight — it's the punchline
        if highlight:
            page.rect(MARGIN, ry, CW, row_h, fill=(244, 249, 244))

        # Color swatch — flush-left vertical slab, full row height
        swatch_w = col_num_w - 10
        page.rect(MARGIN, ry, swatch_w, row_h, fill=color)
        num_text_x = MARGIN + swatch_w // 2 - _text_width(num, 34, True) // 2
        page.text(num_text_x, ry + (row_h - 34) // 2 - 2, num,
                  font_size=34, color=WHITE, bold=True)

        text_y = ry + (row_h - 26) // 2
        # Layer name — if residual, render in the accent tone for emphasis
        layer_color = color if highlight else NAVY
        page.text(MARGIN + col_num_w + 14, text_y, layer,
                  font_size=26, color=layer_color, bold=True)
        page.text(MARGIN + col_num_w + col_layer_w + 14, text_y, inst,
                  font_size=20, color=color, bold=True)
        page.text(MARGIN + col_num_w + col_layer_w + col_inst_w + 14,
                  text_y, meaning,
                  font_size=22,
                  color=NAVY if highlight else TEXT_DARK,
                  bold=highlight,
                  italic=highlight,
                  max_width=col_mean_w - 20)

        # Hairline between rows (except after the highlight row)
        if not highlight:
            page.hline(ry + row_h, x0=MARGIN, x1=MARGIN + CW,
                       color=HAIRLINE, thickness=1)
        ry += row_h


# ═══════════════════════════════════════════════════════════════════════
# Zone 5 — Trade map (hero waterfall + callout) (560px)
# ═══════════════════════════════════════════════════════════════════════
def render_trade_map(
    page: SnapshotComposer, y: int, visuals: list[Path],
) -> None:
    _section_mark(page, MARGIN, y, "03", "THE TRADE MAP  \u00b7  NOT ATTRIBUTION")

    body_y = y + 46
    body_h = Z5_TRADEMAP_H - 78  # leave room for caption below

    split_gap = 26
    hero_w = int(CW * 0.70) - split_gap // 2
    callout_w = CW - hero_w - split_gap
    callout_x = MARGIN + hero_w + split_gap

    # Hero — crop native Plotly title off the top, let our section mark
    # do the typographic work.
    img = _load_visual(
        visuals, "tech_waterfall_compare.png",
        crop_top=130,
    )
    if img is not None:
        _paste_fitted(page, img, MARGIN, body_y, hero_w, body_h)
    _corner_ticks(page, MARGIN, body_y, hero_w, body_h, size=18, color=NAVY)
    page.text(
        MARGIN, body_y + body_h + 8,
        "FIG. 02  \u00b7  AAPL vs NVDA ERM3 waterfall decomposition, trailing year. "
        "Each bar is executable against its named ETF.",
        font_size=14, color=TEXT_LIGHT, bold=True,
    )

    # Callout — a single typographic sentence, weight-shifted inline
    page.rect(callout_x, body_y, callout_w, body_h, fill=NAVY)
    page.rect(callout_x, body_y, 6, body_h, fill=ACCENT)  # left rail, not top

    cy = body_y + 46
    page.text(callout_x + 30, cy, "THIS IS NOT",
              font_size=20, color=NAVY_DIM, bold=True)
    cy += 34
    page.text(callout_x + 30, cy, "attribution.",
              font_size=56, color=WHITE, bold=True, italic=True,
              max_width=callout_w - 60)
    cy += 100
    page.text(callout_x + 30, cy, "THIS IS A",
              font_size=20, color=NAVY_DIM, bold=True)
    cy += 34
    page.text(callout_x + 30, cy, "trade map.",
              font_size=62, color=ACCENT, bold=True, italic=True,
              max_width=callout_w - 60)
    cy += 116

    # Hairline divider before body
    page.hline(cy, x0=callout_x + 30, x1=callout_x + callout_w - 30,
               color=NAVY_DIM, thickness=1)
    cy += 20

    page.text(
        callout_x + 30, cy,
        "Every bar is an ETF-executable bet \u2014",
        font_size=17, color=WHITE, max_width=callout_w - 60,
    )
    page.text(
        callout_x + 30, cy + 28,
        "long or short, sized in dollars.",
        font_size=17, color=WHITE, bold=True, max_width=callout_w - 60,
    )
    page.text(
        callout_x + 30, cy + 68,
        "Route it to the OMS \u2014",
        font_size=17, color=NAVY_INK, italic=True,
        max_width=callout_w - 60,
    )
    page.text(
        callout_x + 30, cy + 94,
        "not the quarterly review.",
        font_size=17, color=ACCENT, italic=True, bold=True,
        max_width=callout_w - 60,
    )


# ═══════════════════════════════════════════════════════════════════════
# Zone 6 — Wedge quote + 3 differentiated imperative tiles (420px)
# ═══════════════════════════════════════════════════════════════════════
def render_wedge_imperatives(
    page: SnapshotComposer, y: int, _visuals: list[Path],
) -> None:
    # Wedge band — full-bleed navy with an editorial pull-quote treatment
    wedge_h = 190
    page.rect(MARGIN, y, CW, wedge_h, fill=NAVY)
    # Giant opening quote glyph — signature flourish
    page.text(MARGIN + 30, y + 6, "\u201c",
              font_size=180, color=ACCENT, bold=True)
    # Quote body — two contrasted lines with proper leading
    page.text(
        MARGIN + 200, y + 36,
        "We don\u2019t explain your portfolio.",
        font_size=34, color=NAVY_INK, italic=True,
        max_width=CW - 230,
    )
    page.text(
        MARGIN + 200, y + 100,
        "We show you what you actually bought.",
        font_size=44, color=WHITE, bold=True,
        max_width=CW - 230,
    )
    # Attribution line
    page.text_right(MARGIN + CW - 24, y + wedge_h - 32,
                    "\u2014  THE ERM3 THESIS",
                    font_size=13, color=NAVY_DIM, bold=True)

    # Section mark for the imperatives
    _section_mark(page, MARGIN, y + wedge_h + 24, "04",
                  "WHAT THIS LETS YOU DO")

    tiles_y = y + wedge_h + 66
    tiles_h = Z6_WEDGE_H - wedge_h - 66
    split_gap = 22
    tile_w = (CW - 2 * split_gap) // 3

    # Tiles are DIFFERENTIATED by palette — NAVY / PAPER / ACCENT, escalating.
    tiles = [
        ("SIZE.",    "Allocate by exposure,\nnot dollars.",
            NAVY,   WHITE, NAVY_INK,    ACCENT),
        ("HEDGE.",   "Neutralize SPY, sector,\nor subsector directly.",
            PAPER,  NAVY,  TEXT_DARK,   TEAL),
        ("EXPRESS.", "Residual is the bet\nyou actually own.",
            ACCENT, WHITE, (255, 235, 210), WHITE),
    ]
    for i, (verb, body, bg, fg, body_fg, rule_color) in enumerate(tiles):
        tx = MARGIN + i * (tile_w + split_gap)
        page.rect(tx, tiles_y, tile_w, tiles_h, fill=bg)
        # Tile index — editorial numeral in the top-right of each tile
        idx_color = ACCENT if bg != ACCENT else (255, 235, 210)
        page.text_right(tx + tile_w - 24, tiles_y + 22,
                        f"0{i + 1}",
                        font_size=18, color=idx_color, bold=True)
        # Signature VERB — anchors each tile
        page.text(tx + 26, tiles_y + 48, verb,
                  font_size=54, color=fg, bold=True,
                  max_width=tile_w - 52)
        # Hairline under the verb
        page.hline(tiles_y + 116, x0=tx + 26, x1=tx + tile_w - 26,
                   color=rule_color, thickness=2)
        # Body — larger leading so 2-line copy doesn't clip
        body_y = tiles_y + 132
        for line in body.split("\n"):
            body_y = page.text(
                tx + 26, body_y, line,
                font_size=21, color=body_fg, bold=True,
                max_width=tile_w - 52,
            )


# ═══════════════════════════════════════════════════════════════════════
# Zone 7 — CTA band (240px)
# ═══════════════════════════════════════════════════════════════════════
def render_cta(page: SnapshotComposer, y: int, _visuals: list[Path]) -> None:
    page.rect(0, y, W, Z7_CTA_H, fill=NAVY)
    # Double-rule top: thick ACCENT + thin navy-ink
    page.rect(0, y, W, 8, fill=ACCENT)
    page.hline(y + 14, x0=MARGIN, x1=W - MARGIN,
               color=NAVY_DIM, thickness=1)

    # Two-column CTA: left headline, right 3-row metadata
    left_w  = int(CW * 0.56)
    right_x = MARGIN + left_w + 30
    right_w = W - MARGIN - right_x

    # Left: CTA label + oversized call
    page.text(MARGIN, y + 36, "CALL TO ACTION",
              font_size=14, color=ACCENT, bold=True)
    page.text(MARGIN, y + 74,
              "Get exposures for any stock,",
              font_size=38, color=WHITE, bold=True,
              max_width=left_w)
    page.text(MARGIN, y + 124,
              "in seconds.",
              font_size=38, color=NAVY_INK, italic=True, bold=True,
              max_width=left_w)

    # Horizontal divider between cols
    page.rect(MARGIN + left_w + 2, y + 36, 2, Z7_CTA_H - 80, fill=NAVY_DIM)

    # Right: 3-row metadata stack
    cta_rows = [
        ("INSTALL", "pip install riskmodels-py"),
        ("PRICE",   "$0.005 per API call  \u00b7  metered"),
        ("KEY",     "riskmodels.app/get-key"),
    ]
    # Space the rows to fill the column height above the footer URL.
    available = Z7_CTA_H - 36 - 68  # top padding - bottom reserved
    row_spacing = available // 3
    row_y = y + 40
    for label, value in cta_rows:
        page.text(right_x, row_y + 6, label,
                  font_size=13, color=ACCENT, bold=True)
        page.text(right_x + 100, row_y, value,
                  font_size=22, color=WHITE, bold=True,
                  max_width=right_w - 100)
        row_y += row_spacing

    # Bottom row: free-trial detail, subtle
    page.text_right(W - MARGIN, y + Z7_CTA_H - 42,
                    "OAuth magic-link  \u00b7  free trial credits",
                    font_size=15, color=NAVY_DIM, bold=True)


# ═══════════════════════════════════════════════════════════════════════
# Identity bar (56px) — signature dossier footer
# ═══════════════════════════════════════════════════════════════════════
def render_identity_bar(page: SnapshotComposer, y: int) -> None:
    # Full-bleed strip, same NAVY as CTA — single continuous bottom stack
    page.rect(0, y, W, IDENTITY_BAR_H, fill=NAVY)
    # Accent hairline above to separate identity bar from CTA typographically
    page.hline(y, x0=0, x1=W, color=ACCENT, thickness=2)
    # Subtle inner hairline a few px down
    page.hline(y + 6, x0=MARGIN, x1=W - MARGIN,
               color=NAVY_DIM, thickness=1)

    # Left: publication id
    page.text(MARGIN, y + 20,
              "DOSSIER NO. 01  \u00b7  THE POSITION THESIS  \u00b7  SPRING 2026",
              font_size=13, color=NAVY_INK, bold=True)
    # Center: edition
    page.text_center(y + 20,
                     "riskmodels.app",
                     font_size=13, color=ACCENT, bold=True)
    # Right: disclaimer
    page.text_right(W - MARGIN, y + 20,
                    "ERM3 V3  \u00b7  BW MACRO  \u00b7  NOT INVESTMENT ADVICE",
                    font_size=13, color=NAVY_INK, bold=True)


# ═══════════════════════════════════════════════════════════════════════
# Orchestrator
# ═══════════════════════════════════════════════════════════════════════
ZoneRenderer = Callable[[SnapshotComposer, int, list[Path]], None]

ZONES: list[tuple[ZoneRenderer, int]] = [
    (render_header,            Z1_HEADER_H),
    (render_hook,              Z2_HOOK_H),
    (render_proof,             Z3_PROOF_H),
    (render_decomp,            Z4_DECOMP_H),
    (render_trade_map,         Z5_TRADEMAP_H),
    (render_wedge_imperatives, Z6_WEDGE_H),
    (render_cta,               Z7_CTA_H),
]


def render_product_tear_sheet(
    output_path: str | Path,
    *,
    visuals_dir: str | Path | None = None,
) -> Path:
    search_paths: list[Path] = []
    if visuals_dir:
        search_paths.append(Path(visuals_dir).resolve())
    search_paths.append(_VISUALS_MEDIUM.resolve())
    search_paths.append(_VISUALS_PART1.resolve())

    page = SnapshotComposer(W, H, bg="#ffffff")
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    y = 110  # top margin
    for i, (renderer, height) in enumerate(ZONES):
        # Anchor the CTA band to the identity bar (full-bleed stack at bottom)
        is_cta = (i == len(ZONES) - 1)
        if is_cta:
            y = H - IDENTITY_BAR_H - height
        renderer(page, y, search_paths)
        y += height + GUTTER

    # Identity bar flush to the bottom edge, directly under the CTA
    render_identity_bar(page, H - IDENTITY_BAR_H)

    return page.save(out)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent / "output" / "riskmodels_tear_sheet.pdf"
    render_product_tear_sheet(out)
    print(f"Saved: {out}  ({out.stat().st_size // 1024} KB)")
