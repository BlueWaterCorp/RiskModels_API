"""One-page product tear sheet for riskmodels.app.

Portrait letter (8.5x11 @ 300 DPI). No API calls — static marketing copy
plus pre-rendered PNGs from the Medium article pipeline.

Usage:
    python -m riskmodels.snapshots.product_tear_sheet
"""
from __future__ import annotations

from pathlib import Path

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

# ── Dimensions ──────────────────────────────────────────────────────────
W = 2550   # 8.5" @ 300 DPI
H = 3300   # 11"  @ 300 DPI
MARGIN = 110
CW = W - 2 * MARGIN  # content width = 2330

_DEFAULT_VISUALS = (
    Path(__file__).resolve().parent.parent.parent.parent
    / ".." / "RM_ORG" / "content" / "Medium" / "visuals"
)


def _fit(src_w: int, src_h: int, max_w: int, max_h: int) -> tuple[int, int]:
    scale = min(max_w / src_w, max_h / src_h)
    return max(1, int(src_w * scale)), max(1, int(src_h * scale))


def _load_visual(
    visuals_dir: Path, name: str, *, crop_top: int = 0,
) -> Image.Image | None:
    p = visuals_dir / name
    if not p.exists():
        return None
    img = Image.open(str(p)).convert("RGB")
    if crop_top > 0:
        img = img.crop((0, crop_top, img.size[0], img.size[1]))
    return img


def render_product_tear_sheet(
    output_path: str | Path,
    *,
    visuals_dir: str | Path | None = None,
) -> Path:
    vdir = Path(visuals_dir).resolve() if visuals_dir else _DEFAULT_VISUALS.resolve()
    page = SnapshotComposer(W, H, bg="#ffffff")
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # ════════════════════════════════════════════════════════════════
    # HEADER
    # ════════════════════════════════════════════════════════════════
    logo = render_portal_riskmodels_brand_logo(max_width=550, max_height=90)
    page.paste_image(logo, MARGIN, 55)
    page.text_right(W - MARGIN, 65, "riskmodels.app",
                    font_size=34, color=TEAL, bold=True)
    page.hline(170, x0=MARGIN, x1=W - MARGIN, color=NAVY, thickness=5)
    y = 190

    # ════════════════════════════════════════════════════════════════
    # TAGLINE
    # ════════════════════════════════════════════════════════════════
    y = page.text(MARGIN, y,
                  "Decompose equity returns into tradeable ETF layers.",
                  font_size=42, color=NAVY, bold=True, max_width=CW)
    y = page.text(MARGIN, y + 4,
                  "ERM3 isolates each layer with orthogonalized hedge ratios "
                  "mapped to liquid ETFs \u2014 no latent factors, no double-counting.",
                  font_size=23, color=TEXT_MID, max_width=CW)

    # ════════════════════════════════════════════════════════════════
    # HERO VISUAL (full width)
    # ════════════════════════════════════════════════════════════════
    y += 18
    hero = _load_visual(vdir, "section_I_cumulative_returns.png")
    if hero:
        fw, fh = _fit(hero.size[0], hero.size[1], CW, 700)
        x_off = MARGIN + (CW - fw) // 2
        page.rect(x_off - 12, y - 6, fw + 24, fh + 12,
                  fill=LIGHT_BG, outline=BORDER)
        page.paste_image(hero, x_off, y, fw, fh)
        y += fh + 14
    else:
        y += 60

    y = page.text(MARGIN, y,
                  "NVDA trailing-year performance: Market / Sector / Subsector / "
                  "Residual layers via geometric attribution.",
                  font_size=20, color=TEXT_LIGHT, italic=True, max_width=CW)

    # ════════════════════════════════════════════════════════════════
    # NARRATIVE
    # ════════════════════════════════════════════════════════════════
    y += 14
    page.hline(y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=1)
    y += 12

    y = page.text(MARGIN, y,
                  "Most institutional risk conversation revolves around style "
                  "factors \u2014 Momentum, Value, Growth, Quality. But these are "
                  "emergent symptoms of subsector bets, not fundamental drivers. "
                  "Harvey, Liu & Zhu (2016) documented 300+ published \"factors,\" "
                  "most redundant or data-mined. You cannot hedge \"Growth\" with "
                  "any precision \u2014 but you can hedge a Semiconductor overweight "
                  "by shorting SMH in the exact dollar amount the model prescribes.",
                  font_size=25, color=TEXT_DARK, max_width=CW)

    # ── Stat callout ──
    y += 10
    page.rect(MARGIN, y, CW, 90, fill=LIGHT_BG, outline=BORDER)
    page.text(MARGIN + 24, y + 12,
              "NVDA: +60.9% gross \u2014 but 75% was systematic. "
              "Only 25% was true idiosyncratic alpha.",
              font_size=25, color=NAVY, bold=True, max_width=CW - 48)
    page.text(MARGIN + 24, y + 52,
              "Manage the subsector layer, and style drift takes care of itself.",
              font_size=22, color=TEXT_MID, max_width=CW - 48)
    y += 106

    # ════════════════════════════════════════════════════════════════
    # SIDE-BY-SIDE: Cascade (left) + Peer DNA (right)
    # ════════════════════════════════════════════════════════════════
    page.hline(y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=1)
    y += 10
    gap = 36
    half_w = (CW - gap) // 2
    right_x = MARGIN + half_w + gap

    # Calculate available height for visuals: from vis_y to CTA top
    # CTA band = 210px, footer = 30px, gap = 16px → anchor from bottom
    cta_h = 200
    cta_y = H - cta_h - 22  # 22px footer
    vis_max_h = cta_y - y - 56  # 56px for section titles + small pad

    # Left: Cascade (PNG has its own title/subtitle — no extra text needed)
    page.text(MARGIN, y, "The ERM3 Cascade",
              font_size=24, color=NAVY, bold=True)

    cascade = _load_visual(vdir, "orthogonalization_cascade.png")
    vis_y = y + 38
    if cascade:
        cw, ch = _fit(cascade.size[0], cascade.size[1], half_w, vis_max_h)
        page.paste_image(cascade, MARGIN, vis_y, cw, ch)

    # Right: Peer DNA (crop baked-in title bar — ~100px at top of PNG)
    page.text(right_x, y, "Peer Risk DNA",
              font_size=24, color=NAVY, bold=True)

    dna = _load_visual(vdir, "section_III_peer_dna.png", crop_top=100)
    if dna:
        dna_max_h = vis_max_h - 40  # room for subtitle below title
        page.text(right_x, vis_y - 4,
                  "NVDA + top SMH peers. Bar width = total volatility. "
                  "Color = risk absorbed by each ERM3 layer.",
                  font_size=17, color=TEXT_MID, max_width=half_w)
        dw, dh = _fit(dna.size[0], dna.size[1], half_w, dna_max_h)
        page.paste_image(dna, right_x, vis_y + 40, dw, dh)

    # ── Find where the visuals actually end ──
    cascade_h = 0
    if cascade:
        cw2, ch2 = _fit(cascade.size[0], cascade.size[1], half_w, vis_max_h)
        cascade_h = ch2
    dna_h = 0
    if dna:
        dw2, dh2 = _fit(dna.size[0], dna.size[1], half_w, vis_max_h - 40)
        dna_h = dh2 + 40  # account for subtitle offset
    content_bottom = vis_y + max(cascade_h, dna_h) + 16

    # ── Fill remaining space with content ──
    page.hline(content_bottom, x0=MARGIN, x1=W - MARGIN,
               color=BORDER, thickness=1)
    ty = content_bottom + 12

    page.text(MARGIN, ty, "From Diagnosis to Execution",
              font_size=24, color=NAVY, bold=True)
    ty += 38
    ty = page.text(
        MARGIN, ty,
        "The engine transforms orthogonalized betas into hedge ratios "
        "that work with raw ETF prices. Link-beta adjustments prevent "
        "double-hedging across levels. Each coefficient maps to a dollar "
        "notional routable to your OMS \u2014 isolating pure alpha without "
        "liquidating the underlying position.",
        font_size=22, color=TEXT_DARK, max_width=CW,
    )
    ty += 10
    ty = page.text(
        MARGIN, ty,
        "Workflows: morning risk audit via Plaid-connected holdings, "
        "automated drift guardrails with Slack alerts, pre-trade impact "
        "simulation, and peer benchmarking \u2014 all from a single API call.",
        font_size=22, color=TEXT_DARK, max_width=CW,
    )

    # ── Anchor CTA to content bottom ──
    cta_y = max(ty + 16, H - cta_h - 22)

    # ════════════════════════════════════════════════════════════════
    # CTA BAND
    # ════════════════════════════════════════════════════════════════
    page.rect(0, cta_y, W, cta_h, fill=NAVY)

    cta_col_w = CW // 3
    cta_data = [
        ("$0.005 / API call",
         "Python/TS SDK \u00b7 OpenAPI 3.0\nNo subscription required"),
        ("Plaid Custody Integration",
         "Schwab \u00b7 Fidelity \u00b7 Robinhood\nLive holdings, auto-resolved"),
        ("Built for",
         "RIAs \u00b7 Allocators\nQuant Devs \u00b7 AI Agents"),
    ]
    for i, (heading, detail) in enumerate(cta_data):
        cx = MARGIN + i * cta_col_w
        page.text(cx, cta_y + 18, heading,
                  font_size=25, color=WHITE, bold=True)
        page.text(cx, cta_y + 52, detail,
                  font_size=19, color=(200, 220, 240))

    page.text_center(cta_y + cta_h - 46, "riskmodels.app",
                     font_size=34, color=WHITE, bold=True)

    # ── Footer ──
    page.text_center(H - 18, "ERM3 V3 \u00b7 BW Macro \u00b7 Not investment advice.",
                     font_size=11, color=TEXT_LIGHT)

    return page.save(out)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent / "output" / "riskmodels_tear_sheet.pdf"
    render_product_tear_sheet(out)
    print(f"Saved: {out}  ({out.stat().st_size // 1024} KB)")
