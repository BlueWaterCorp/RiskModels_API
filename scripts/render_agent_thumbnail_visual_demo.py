#!/usr/bin/env python3
"""Render a **visual** agent-thumbnail demo PNG (stacked L3 bar + chips), not a text wall.

Requires Pillow. Run from repo root:

    python scripts/render_agent_thumbnail_visual_demo.py

Writes:
  public/docs/readme/agent_thumbnail_demo.png (tracked whitelist)
  screenshots/agent_thumbnail_demo.png (local preview; gitignored root)
"""

from __future__ import annotations

import sys
from pathlib import Path

# Repo root → sdk on path
_ROOT = Path(__file__).resolve().parents[1]
_SDK = _ROOT / "sdk"
if str(_SDK) not in sys.path:
    sys.path.insert(0, str(_SDK))

from PIL import Image, ImageDraw, ImageFont

from riskmodels.visuals.l3_decomposition import L3_API_LAYER_COLORS
from riskmodels.views.agent_thumbnail import agent_thumbnail, get_layer_shares

LAYER_ORDER = ("market", "sector", "subsector", "residual")


def _truetype_sizes() -> tuple[ImageFont.FreeTypeFont, ...]:
    pairs = (
        (
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ),
        ("/Library/Fonts/Arial Bold.ttf", "/Library/Fonts/Arial.ttf"),
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ),
    )
    for bold_fp, reg_fp in pairs:
        try:
            return (
                ImageFont.truetype(bold_fp, 22),
                ImageFont.truetype(reg_fp, 18),
                ImageFont.truetype(reg_fp, 15),
                ImageFont.truetype(reg_fp, 14),
            )
        except OSError:
            continue
    de = ImageFont.load_default()
    return (de, de, de, de)


def _bar_segment_pixel_widths(*, fractions: tuple[float, float, float, float], bar_w: int) -> tuple[int, int, int, int]:
    """Largest-remainder integers so widths sum exactly to ``bar_w``."""

    scaled = [f * bar_w for f in fractions]
    floors = [int(s) for s in scaled]
    rem = bar_w - sum(floors)
    order = sorted(range(4), key=lambda i: scaled[i] - floors[i], reverse=True)
    for k in range(rem):
        floors[order[k]] += 1
    return (floors[0], floors[1], floors[2], floors[3])


def _pill(
    draw: ImageDraw.ImageDraw,
    *,
    xy: tuple[int, int],
    label: str,
    value: str,
    fg: str,
    bg: str,
    font: ImageFont.ImageFont,
) -> tuple[int, int]:
    pad_x, pad_y = 14, 8
    text = f"{label}: {value}"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    w, h = tw + pad_x * 2, th + pad_y * 2
    x0, y0 = xy
    draw.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=10, fill=bg, outline=fg, width=2)
    draw.text((x0 + pad_x, y0 + pad_y - 1), text, fill=fg, font=font)
    return w + 12, h


def render(payload: dict, out_paths: list[Path]) -> None:
    thumb = agent_thumbnail(dict(payload))
    shares = get_layer_shares(payload)

    font_title, font_body, font_small, font_pill = _truetype_sizes()

    W, H = 880, 420
    margin = 36
    bg = "#f1f5f9"
    fg = "#0f172a"
    accent = "#0c4a6e"

    im = Image.new("RGB", (W, H), bg)
    dr = ImageDraw.Draw(im)

    dr.rounded_rectangle([8, 8, W - 9, H - 9], radius=16, outline=accent, width=4)

    y = margin
    dr.text((margin, y), "L3 variance thumbnail (demo)", fill=accent, font=font_title)
    bbox = dr.textbbox((0, 0), "L3 variance thumbnail (demo)", font=font_title)
    y += bbox[3] - bbox[1] + 8
    dr.text((margin, y), thumb["summary"], fill=fg, font=font_body)
    bbox = dr.textbbox((0, 0), thumb["summary"], font=font_body)
    y += bbox[3] - bbox[1] + 20

    bar_left, bar_w = margin, W - 2 * margin
    bar_h = 52
    bar_top = y
    fractions = tuple(float(shares[L]) for L in LAYER_ORDER)
    widths = _bar_segment_pixel_widths(fractions=fractions, bar_w=bar_w)
    x_cursor = bar_left
    for layer, frac, seg_w in zip(LAYER_ORDER, fractions, widths, strict=True):
        color = L3_API_LAYER_COLORS[layer]
        x1 = x_cursor + seg_w
        dr.rectangle([x_cursor, bar_top, x1, bar_top + bar_h], fill=color, outline=color)
        if seg_w >= 74:
            pct = f"{100.0 * frac:.0f}%"
            bx = dr.textbbox((0, 0), pct, font=font_small)
            tw = bx[2] - bx[0]
            tx = x_cursor + max(0, (seg_w - tw) // 2)
            ty = bar_top + (bar_h - (bx[3] - bx[1])) // 2
            dr.text((tx, ty), pct, fill="#ffffff", font=font_small)
        x_cursor = x1

    bar_right = bar_left + bar_w
    dr.rectangle([bar_left, bar_top, bar_right, bar_top + bar_h], outline="#334155", width=2)
    y = bar_top + bar_h + 18

    chip_x = margin
    chip_y = y
    w1, h1 = _pill(
        dr,
        xy=(chip_x, chip_y),
        label="signal",
        value=thumb["residual_signal"],
        fg="#92400e",
        bg="#ffedd5",
        font=font_pill,
    )
    chip_x += w1
    _pill(
        dr,
        xy=(chip_x, chip_y),
        label="dominant",
        value=thumb["dominant_layer"],
        fg="#1e3a8a",
        bg="#dbeafe",
        font=font_pill,
    )
    y = chip_y + h1 + 16

    dr.text((margin, y), thumb["hedge_hint"], fill=accent, font=font_body)
    bbox = dr.textbbox((0, 0), thumb["hedge_hint"], font=font_body)
    y += bbox[3] - bbox[1] + 18

    legend_y = y
    lx = margin
    row_gap = 0
    legend_parts: list[tuple[int, str, str]] = []
    for layer in LAYER_ORDER:
        col = L3_API_LAYER_COLORS[layer]
        cap = f"{layer} · {100.0 * shares[layer]:.0f}%"
        bx = dr.textbbox((0, 0), cap, font=font_small)
        tw = bx[2] - bx[0]
        legend_parts.append((tw, cap, col))
    total_leg = sum(tw + 28 for tw, _, _ in legend_parts) + 22 * len(legend_parts)
    if lx + total_leg > W - margin:
        row_gap = 24
    lx = margin
    for i, (_, cap, col) in enumerate(legend_parts):
        if i == 2 and row_gap > 0:
            lx = margin
            legend_y += row_gap
        sw = 14
        dr.rounded_rectangle([lx, legend_y, lx + sw, legend_y + sw], radius=3, fill=col)
        dr.text((lx + sw + 8, legend_y - 2), cap, fill="#475569", font=font_small)
        bx = dr.textbbox((0, 0), cap, font=font_small)
        lx += sw + 8 + (bx[2] - bx[0]) + 28

    for p in out_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p, format="PNG", optimize=True)


def main() -> None:
    payload = {
        "ticker": "NVDA",
        "data_as_of": "2026-04-29",
        "exposure": {
            "market": {"er": 0.62, "hr": 1.10, "hedge_etf": "SPY"},
            "sector": {"er": 0.10, "hr": 0.35, "hedge_etf": "XLK"},
            "subsector": {"er": 0.10, "hr": 0.60, "hedge_etf": "SMH"},
            "residual": {"er": 0.18, "hr": None, "hedge_etf": None},
        },
        "hedge": {"SPY": -1.10, "XLK": -0.35, "SMH": -0.60},
    }
    out = [
        _ROOT / "public" / "docs" / "readme" / "agent_thumbnail_demo.png",
        _ROOT / "screenshots" / "agent_thumbnail_demo.png",
    ]
    render(payload, out)
    for o in out:
        print(o)


if __name__ == "__main__":
    main()
