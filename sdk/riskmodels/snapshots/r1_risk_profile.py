"""R1 Snapshot — Factor Risk Profile (Current × Stock).

The first page of the Risk suite: where is this stock's risk coming from?
Pure Plotly rendering — no Matplotlib, no WeasyPrint, no HTML.

Layout (Letter Landscape, composed via Plotly subplots)
-------------------------------------------------------
  Header    : Title + subtitle + metric chips
  Top-left  : L3 ER Decomposition (hbar)
  Top-right : Hedge-Ratio Cascade (grouped vbar)
  Middle    : Full-width peer comparison table
  Bottom    : AI narrative text block
  Footer    : Confidential + data TEO + SDK version

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots import get_data_for_r1, render_r1_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_r1("NVDA", client)
    data.to_json("nvda_r1.json")
    render_r1_to_pdf(data, "NVDA_R1_Risk.pdf")

    # Or offline:
    data = R1Data.from_json("nvda_r1.json")
    render_r1_to_pdf(data, "NVDA_R1_Risk.pdf")

Fetch/render separation
-----------------------
    get_data_for_r1()  — all API calls (StockContext + PeerGroupProxy)
    render_r1_to_pdf() — pure Plotly, no network calls
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go

from ..peer_group import PeerComparison, PeerGroupProxy
from ._plotly_theme import PLOTLY_THEME, apply_theme
from ._compose import (
    SnapshotComposer, NAVY, TEAL, TEXT_DARK, TEXT_MID, TEXT_LIGHT,
    WHITE, LIGHT_BG, BORDER,
)
from ..visuals.smart_subheader import generate_subheader

T = PLOTLY_THEME


# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class R1Data:
    """All data needed to render the R1 Factor Risk Profile snapshot.

    Produced by get_data_for_r1(). Consumed by render_r1_to_pdf().
    No API calls happen after this object is created.
    """

    ticker: str
    company_name: str
    teo: str
    universe: str
    sector_etf: str | None
    subsector_etf: str | None

    metrics: dict[str, Any]
    peer_comparison: PeerComparison | None = None
    narrative: str = ""
    macro_correlations: dict[str, float | None] = field(default_factory=dict)
    sdk_version: str = "0.3.0"

    @property
    def subsector_label(self) -> str:
        return self.subsector_etf or self.sector_etf or "—"

    # ── JSON serialization ───────────────────────────────────────────

    def to_json(self, path: str | Path) -> Path:
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "R1Data":
        from ._json_io import load_json

        raw = load_json(path)
        d = raw["data"]

        pc = None
        pc_raw = d.get("peer_comparison")
        if pc_raw is not None:
            peer_detail_records = pc_raw.get("peer_detail", [])
            peer_detail_df = pd.DataFrame(peer_detail_records)
            if not peer_detail_df.empty and "ticker" in peer_detail_df.columns:
                peer_detail_df = peer_detail_df.set_index("ticker")

            pp_raw = pc_raw.get("peer_portfolio", {})
            from ..portfolio_math import PortfolioAnalysis
            from ..lineage import RiskLineage
            peer_portfolio = PortfolioAnalysis(
                lineage=RiskLineage(),
                per_ticker=pd.DataFrame(pp_raw.get("per_ticker", [])),
                portfolio_hedge_ratios=pp_raw.get("portfolio_hedge_ratios", {}),
                portfolio_l3_er_weighted_mean=pp_raw.get("portfolio_l3_er_weighted_mean", {}),
                weights=pp_raw.get("weights", {}),
                errors=pp_raw.get("errors", {}),
            )

            pc = PeerComparison(
                target_ticker=pc_raw["target_ticker"],
                peer_group_label=pc_raw["peer_group_label"],
                target_metrics=pc_raw.get("target_metrics", {}),
                peer_portfolio=peer_portfolio,
                target_l3_residual_er=pc_raw.get("target_l3_residual_er"),
                peer_avg_l3_residual_er=pc_raw.get("peer_avg_l3_residual_er"),
                selection_spread=pc_raw.get("selection_spread"),
                target_vol=pc_raw.get("target_vol"),
                peer_avg_vol=pc_raw.get("peer_avg_vol"),
                peer_detail=peer_detail_df,
            )

        return cls(
            ticker=d["ticker"],
            company_name=d["company_name"],
            teo=d["teo"],
            universe=d["universe"],
            sector_etf=d.get("sector_etf"),
            subsector_etf=d.get("subsector_etf"),
            metrics=d["metrics"],
            peer_comparison=pc,
            narrative=d.get("narrative", ""),
            macro_correlations=d.get("macro_correlations", {}),
            sdk_version=d.get("sdk_version", "0.3.0"),
        )


# ---------------------------------------------------------------------------
# AI Narrative generation — per-component smart insights
# ---------------------------------------------------------------------------

@dataclass
class R1Insights:
    """Connected narrative insights that build a coherent story across all R1 panels.

    The arc: What's driving returns → How exposed is the stock → Where does it rank
    → So what should you do. Each insight references context from other panels.
    """
    er_insight: str = ""        # I. Return Attribution — what's driving performance
    hr_insight: str = ""        # II. Risk Sensitivity — how exposed is the position
    peer_insight: str = ""      # III. Peer Benchmarking — relative standing
    summary: str = ""           # IV. Key Risk Summary — the "so what" that ties it together


def _generate_insights(data: R1Data) -> R1Insights:
    """Build connected analyst insights that cross-reference across panels."""
    m = data.metrics
    pc = data.peer_comparison
    ticker = data.ticker
    sub = data.subsector_label

    def _gm(full: str, abbr: str) -> Any:
        return m.get(full) if m.get(full) is not None else m.get(abbr)

    mkt_er = float(_gm("l3_market_er", "l3_mkt_er") or 0) * 100
    sec_er = float(_gm("l3_sector_er", "l3_sec_er") or 0) * 100
    sub_er = float(_gm("l3_subsector_er", "l3_sub_er") or 0) * 100
    res_er = float(_gm("l3_residual_er", "l3_res_er") or 0) * 100
    mkt_hr = float(_gm("l3_market_hr", "l3_mkt_hr") or 0)
    sec_hr = float(_gm("l3_sector_hr", "l3_sec_hr") or 0)
    vol_raw = _gm("vol_23d", "volatility")
    vol = float(vol_raw) * 100 if vol_raw else None

    factors = {"market": abs(mkt_er), "sector": abs(sec_er),
               "subsector": abs(sub_er), "residual": abs(res_er)}
    total_er = sum(factors.values()) or 1e-9
    dominant = max(factors, key=factors.get)  # type: ignore
    dominant_pct = factors[dominant] / total_er * 100
    sys_total = abs(mkt_er) + abs(sec_er) + abs(sub_er)

    # Classify the stock's risk profile for cross-referencing
    is_high_beta = mkt_hr > 1.15
    is_alpha_gen = abs(res_er) > 5
    has_peers = pc is not None and pc.selection_spread is not None
    spread_bps = (pc.selection_spread * 10000) if has_peers else 0
    peer_vol = float(pc.peer_avg_vol) * 100 if (pc and pc.peer_avg_vol) else None

    # ── Per-panel subheaders via smart_subheader ──────────────────
    er_data = {
        "l3_market_er": mkt_er / 100, "l3_sector_er": sec_er / 100,
        "l3_subsector_er": sub_er / 100, "l3_residual_er": res_er / 100,
        "l3_market_hr": mkt_hr,
    }
    er_text = generate_subheader(
        chart_type="er_attribution",
        title="L3 Explained-Return Attribution",
        data=er_data,
        data_as_of=data.teo, ticker=ticker, benchmark=sub,
    )

    hr_data = dict(m)  # full metrics for HR context
    hr_text = generate_subheader(
        chart_type="hr_cascade",
        title="Hedge-Ratio Cascade",
        data=hr_data,
        data_as_of=data.teo, ticker=ticker, benchmark=sub,
    )

    peer_data: dict[str, Any] = {
        "selection_spread": pc.selection_spread if has_peers else None,
        "peer_count": len(pc.peer_detail) if pc and not pc.peer_detail.empty else 0,
    }
    peer_text = generate_subheader(
        chart_type="peer_table",
        title="Peer Benchmarking",
        data=peer_data,
        data_as_of=data.teo, ticker=ticker, benchmark=sub,
    )

    # ── IV. Summary — ties everything together ──────────────────────
    # This is the "bottom line" that a PM reads if they only have 10 seconds.
    summary_lead = (
        f"{dominant.capitalize()} risk ({dominant_pct:.0f}% of variance) "
        f"is the primary driver"
    )
    if is_alpha_gen:
        summary_lead += f", but {res_er:+.1f}% residual alpha signals genuine stock selection."
    else:
        summary_lead += f" with limited idiosyncratic contribution ({res_er:+.1f}%)."

    summary_detail = []
    if is_high_beta and vol and peer_vol:
        summary_detail.append(
            f"elevated beta ({mkt_hr:.2f}) and vol ({vol:.1f}% vs {peer_vol:.1f}% peers) "
            f"imply larger drawdowns in risk-off regimes"
        )
    elif vol:
        summary_detail.append(f"Realised vol of {vol:.1f}% (23d)")

    if has_peers:
        if spread_bps > 100:
            summary_detail.append(
                f"+{spread_bps:.0f} bps peer spread suggests market rewards {ticker}'s exposure"
            )
        elif spread_bps < -100:
            summary_detail.append(
                f"{spread_bps:.0f} bps peer deficit warrants monitoring"
            )

    summary = summary_lead
    if summary_detail:
        summary += " " + "; ".join(summary_detail) + "."

    return R1Insights(
        er_insight=er_text,
        hr_insight=hr_text,
        peer_insight=peer_text,
        summary=summary,
    )


def _generate_narrative(data: R1Data) -> str:
    """Legacy wrapper — returns the summary field for backward compat."""
    return _generate_insights(data).summary


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------

def get_data_for_r1(
    ticker: str,
    client: Any,
    *,
    peer_group_by: str = "subsector_etf",
    peer_weighting: str = "market_cap",
) -> R1Data:
    """Fetch everything needed for the R1 Factor Risk Profile snapshot."""
    import warnings
    from ._data import fetch_stock_context

    ctx = fetch_stock_context(ticker, client, years=1, include_spy=False)

    etf_override = ctx.subsector_etf if peer_group_by == "subsector_etf" else ctx.sector_etf

    peer_comparison: PeerComparison | None = None
    try:
        proxy = PeerGroupProxy.from_ticker(
            client, ticker,
            group_by=peer_group_by,
            weighting=peer_weighting,
            sector_etf_override=etf_override,
            max_peers=15,
        )
        peer_comparison = proxy.compare(client)
    except Exception as exc:
        warnings.warn(
            f"Could not build PeerGroupProxy for {ticker}: {exc}. "
            "Rendering R1 without peer context.",
            UserWarning, stacklevel=2,
        )

    macro_correlations: dict[str, float | None] = {}
    try:
        corr_resp = client.get_factor_correlation_single(
            ticker,
            return_type="l3_residual",
            window_days=252,
        )
        macro_correlations = corr_resp.get("correlations", {})
    except Exception as exc:
        warnings.warn(
            f"Could not fetch macro correlations for {ticker}: {exc}",
            UserWarning, stacklevel=2,
        )

    data = R1Data(
        ticker=ctx.ticker,
        company_name=ctx.company_name,
        teo=ctx.teo,
        universe=ctx.universe,
        sector_etf=ctx.sector_etf,
        subsector_etf=ctx.subsector_etf,
        metrics=ctx.metrics,
        peer_comparison=peer_comparison,
        macro_correlations=macro_correlations,
        sdk_version=ctx.sdk_version,
    )

    data.narrative = _generate_narrative(data)
    return data


# ---------------------------------------------------------------------------
# Render step — pure Plotly
# ---------------------------------------------------------------------------

def _g(m: dict, full: str, abbr: str) -> Any:
    """Get metric by full name first, then abbreviated fallback."""
    return m.get(full) if m.get(full) is not None else m.get(abbr)


def _estimate_lines(text: str, font_size: int, max_width: int, line_height: float = 1.4) -> int:
    """Estimate number of wrapped lines for a text block (rough character-based estimate)."""
    if not text:
        return 0
    # Approximate chars per line: max_width / (font_size * 0.55) — conservative
    chars_per_line = max(1, int(max_width / (font_size * 0.55)))
    words = text.split()
    lines, line_len = 1, 0
    for word in words:
        if line_len + len(word) + 1 > chars_per_line:
            lines += 1
            line_len = len(word)
        else:
            line_len += len(word) + 1
    return lines


def _draw_chips(
    page: SnapshotComposer,
    chips: list[tuple[str, str]],
    x: int,
    y: int,
    content_width: int,
) -> int:
    """Draw metric chips as pill badges. Returns y after chips."""
    chip_pad_x, chip_pad_y = 18, 8
    chip_gap = 16
    chip_font = 26
    label_font = 22

    # Arrange chips in rows
    row_x = x
    row_y = y
    row_h = chip_font + chip_pad_y * 2 + label_font + 6

    for label, val in chips:
        # Estimate chip width: val + label below
        val_w = max(len(val), len(label)) * int(chip_font * 0.6) + chip_pad_x * 2
        chip_w = max(val_w, 160)

        if row_x + chip_w > x + content_width and row_x > x:
            row_x = x
            row_y += row_h + chip_gap

        # Pill background
        page.rect(row_x, row_y, chip_w, row_h,
                  fill=LIGHT_BG, outline=BORDER, outline_width=1)
        # Value (larger, bold)
        page.text(row_x + chip_pad_x, row_y + chip_pad_y,
                  val, font_size=chip_font, bold=True, color=TEXT_DARK)
        # Label (smaller, below)
        page.text(row_x + chip_pad_x, row_y + chip_pad_y + chip_font + 4,
                  label, font_size=label_font, color=TEXT_MID)

        row_x += chip_w + chip_gap

    return row_y + row_h


def _fmt_market_cap(v: float | None) -> str:
    """Format market cap as human-readable string."""
    if v is None:
        return "—"
    v = float(v)
    if v >= 1e12:
        return f"${v/1e12:.1f}T"
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M"
    return f"${v:,.0f}"


def _compose_r1_page(data: R1Data) -> SnapshotComposer:
    """Compose the R1 snapshot using pixel-precise Pillow layout + Plotly charts.

    Returns a SnapshotComposer — caller decides export format.
    """
    apply_theme()

    m = data.metrics
    pc = data.peer_comparison
    pal = T.palette
    insights = _generate_insights(data)

    # ── Page grid (11×8.5 in @ 300 DPI = 3300×2550 px) ─────────────
    W, H = 3300, 2550
    MARGIN = 150          # left/right margin

    # ── Panel layout constants ───────────────────────────────────────
    PANEL_W = 800
    PANEL_GAP = 50
    CONTENT_X = MARGIN + PANEL_W + PANEL_GAP
    CONTENT_W = W - CONTENT_X - MARGIN

    # Color constants for macro correlations
    GREEN_RGB = (0, 170, 0)
    ORANGE_RGB = (224, 112, 0)

    page = SnapshotComposer(W, H)
    y = 80  # current vertical cursor

    # ════════════════════════════════════════════════════════════════
    # HEADER
    # ════════════════════════════════════════════════════════════════
    page.text(MARGIN, y, f"{data.ticker} — {data.company_name}",
              font_size=72, bold=True, color=NAVY)
    page.text_right(W - MARGIN, y + 12, "R1 · Factor Risk Profile",
                    font_size=42, color=TEXT_MID)
    y += 90

    page.text(MARGIN, y,
              f"Ticker: {data.ticker}  ·  Benchmark: {data.subsector_label}  ·  As of: {data.teo}",
              font_size=32, color=TEXT_MID)
    y += 55

    # Navy header rule
    page.hline(y, x0=MARGIN, x1=W - MARGIN, color=NAVY, thickness=6)
    after_header_y = y + 20

    # ════════════════════════════════════════════════════════════════
    # LEFT STATS PANEL — background
    # ════════════════════════════════════════════════════════════════
    PANEL_BG = (248, 249, 251)
    page.rect(MARGIN - 10, after_header_y, PANEL_W + 10, H - 90 - after_header_y,
              fill=PANEL_BG)

    # Vertical divider between panel and content
    div_x = CONTENT_X - PANEL_GAP // 2
    page.draw.rectangle(
        [div_x, after_header_y, div_x + 1, H - 90],
        fill=BORDER,
    )

    # ── Draw left panel contents ──────────────────────────────────────
    py = after_header_y + 20  # panel vertical cursor
    panel_right = MARGIN + PANEL_W  # right edge for right-aligning values
    ROW_H = 50   # row height for stat rows
    LBL_SZ = 28  # label font size
    VAL_SZ = 28  # value font size
    SEC_SZ = 22  # section header font size

    # Company name
    company_display = data.company_name
    page.text(MARGIN, py, company_display,
              font_size=42, bold=True, color=NAVY, max_width=PANEL_W)
    py += int(42 * 1.4)

    # Ticker · As of date
    page.text(MARGIN, py, f"{data.ticker}  ·  {data.teo}",
              font_size=LBL_SZ, color=TEXT_MID)
    py += int(LBL_SZ * 1.4) + 16

    # ── IDENTITY section ─────────────────────────────────────────────
    page.text(MARGIN, py, "IDENTITY",
              font_size=SEC_SZ, bold=True, color=TEXT_LIGHT)
    py += int(SEC_SZ * 1.4)
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 10

    mkt_cap_raw = m.get("market_cap") or m.get("mkt_cap")
    mkt_cap_str = _fmt_market_cap(mkt_cap_raw)
    for lbl, val_s in [
        ("Market Cap", mkt_cap_str),
        ("Sector ETF", data.sector_etf or "—"),
        ("Subsector ETF", data.subsector_etf or "—"),
    ]:
        page.text(MARGIN, py, lbl, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_s, font_size=VAL_SZ, bold=True, color=TEXT_DARK)
        py += ROW_H
    py += 16

    # ── FACTOR EXPOSURE section ───────────────────────────────────────
    page.text(MARGIN, py, "FACTOR EXPOSURE — L3",
              font_size=SEC_SZ, bold=True, color=TEXT_LIGHT)
    py += int(SEC_SZ * 1.4)
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 10

    def _gm(full: str, abbr: str):
        return m.get(full) if m.get(full) is not None else m.get(abbr)

    mkt_hr = _gm("l3_market_hr", "l3_mkt_hr")
    sec_hr = _gm("l3_sector_hr", "l3_sec_hr")
    sub_hr = _gm("l3_subsector_hr", "l3_sub_hr")
    mkt_er = _gm("l3_market_er", "l3_mkt_er")
    sec_er = _gm("l3_sector_er", "l3_sec_er")
    sub_er = _gm("l3_subsector_er", "l3_sub_er")
    res_er = _gm("l3_residual_er", "l3_res_er")

    def _beta_color(v) -> tuple:
        return TEXT_MID if v is None else (NAVY if float(v) >= 0 else ORANGE_RGB)

    def _er_color(v) -> tuple:
        return TEXT_MID if v is None else (GREEN_RGB if float(v) > 0 else ORANGE_RGB)

    for label, val in [("Mkt β", mkt_hr), ("Sec β", sec_hr), ("Sub β", sub_hr)]:
        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_MID)
        val_str = T.format_number(val, decimals=2) if val is not None else "—"
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True,
                        color=_beta_color(val))
        py += ROW_H

    for label, val, is_bold in [
        ("Mkt ER", mkt_er, False),
        ("Sec ER", sec_er, False),
        ("Sub ER", sub_er, False),
        ("Res ER (α)", res_er, True),
    ]:
        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_MID)
        val_str = T.format_pct(val) if val is not None else "—"
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=is_bold,
                        color=_er_color(val))
        py += ROW_H

    # Residual Risk (RR) = 1 - sum(|systematic ER| components)
    mkt_er_f = float(mkt_er) if mkt_er is not None else 0.0
    sec_er_f = float(sec_er) if sec_er is not None else 0.0
    sub_er_f = float(sub_er) if sub_er is not None else 0.0
    rr = 1.0 - (abs(mkt_er_f) + abs(sec_er_f) + abs(sub_er_f))
    page.text(MARGIN, py, "Res Risk (RR)", font_size=LBL_SZ, color=TEXT_MID)
    page.text_right(panel_right, py, T.format_pct(rr), font_size=VAL_SZ, bold=False,
                    color=_er_color(rr))
    py += ROW_H + 16

    # ── MACRO CORRELATIONS section ────────────────────────────────────
    page.text(MARGIN, py, "MACRO CORRELATIONS — L3 Residual · 252d",
              font_size=SEC_SZ, bold=True, color=TEXT_LIGHT)
    py += int(SEC_SZ * 1.4)
    page.hline(py, x0=MARGIN, x1=panel_right, color=BORDER, thickness=1)
    py += 10

    MACRO_KEYS = ["vix", "oil", "gold", "bitcoin", "dxy", "ust10y2y"]
    MACRO_NAMES = {"vix": "VIX", "oil": "Oil", "gold": "Gold",
                   "bitcoin": "Bitcoin", "dxy": "DXY", "ust10y2y": "UST 10y-2y"}
    corrs = data.macro_correlations or {}
    BAR_MAX_W = int(PANEL_W * 0.55)  # mini bar max width

    for key in MACRO_KEYS:
        corr = corrs.get(key)
        label = MACRO_NAMES[key]

        if corr is not None:
            corr_f = float(corr)
            val_str = f"{corr_f:+.2f}"
            val_color = GREEN_RGB if corr_f > 0 else ORANGE_RGB
        else:
            corr_f = None
            val_str = "—"
            val_color = TEXT_LIGHT

        page.text(MARGIN, py, label, font_size=LBL_SZ, color=TEXT_MID)
        page.text_right(panel_right, py, val_str, font_size=VAL_SZ, bold=True, color=val_color)

        # Mini bar on the row itself (right side, next to value)
        bar_h = 10
        bar_y = py + (ROW_H - bar_h) // 2
        if corr_f is not None:
            bar_w = max(4, int(abs(corr_f) * BAR_MAX_W))
            bar_x = panel_right - bar_w - 80  # leave room for value text
            page.draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=val_color)

        py += ROW_H

    # ════════════════════════════════════════════════════════════════
    # RIGHT CONTENT AREA
    # ════════════════════════════════════════════════════════════════
    y = after_header_y

    # ── AI Summary box ───────────────────────────────────────────────
    if insights.summary:
        import re as _re
        m_sent = _re.search(r'\.\s+(?=[A-Z])', insights.summary)
        if m_sent:
            lead = insights.summary[:m_sent.start() + 1]
            rest = insights.summary[m_sent.end():].strip()
        else:
            lead, rest = insights.summary, ""

        lead_lines = _estimate_lines(lead, font_size=32, max_width=CONTENT_W - 40, line_height=1.4)
        rest_lines = _estimate_lines(rest, font_size=28, max_width=CONTENT_W - 40, line_height=1.4) if rest else 0
        box_h = 26 + int(lead_lines * 32 * 1.4) + (int(rest_lines * 28 * 1.4) if rest else 0) + 26
        box_h = max(box_h, 100)

        page.rect(CONTENT_X - 10, y, CONTENT_W + 20, box_h, fill=LIGHT_BG)
        ty = y + 22
        ty = page.text(CONTENT_X + 10, ty, lead,
                       font_size=32, bold=True, color=TEXT_DARK, max_width=CONTENT_W - 40)
        if rest:
            page.text(CONTENT_X + 10, ty + 4, rest,
                      font_size=28, color=TEXT_MID, max_width=CONTENT_W - 40)
        y += box_h + 16

    # ── Section I + II titles side by side ───────────────────────────
    half_w = CONTENT_W // 2 - 20

    page.text(CONTENT_X, y, "I. Return Attribution",
              font_size=38, bold=True, color=NAVY)
    page.text(CONTENT_X + half_w + 40, y, "II. Hedge-Ratio Cascade",
              font_size=38, bold=True, color=NAVY)
    y += 56

    # Insight subheaders
    if insights.er_insight:
        page.text(CONTENT_X, y, insights.er_insight,
                  font_size=26, italic=True, color=TEAL, max_width=half_w - 20)
    if insights.hr_insight:
        page.text(CONTENT_X + half_w + 40, y, insights.hr_insight,
                  font_size=26, italic=True, color=TEAL, max_width=half_w - 20)
    y += 72

    # ── compute remaining space and split 48/52 between charts and table ──
    FOOTER_Y = H - 90
    III_HEADER_H = 20 + 56 + 40 + 28
    remaining = FOOTER_Y - y - III_HEADER_H
    chart_h = int(remaining * 0.48)
    table_h = remaining - chart_h - 36

    # ER hbar chart
    er_fig = _make_er_chart(m, pal)
    page.paste_figure(er_fig, CONTENT_X, y, half_w, chart_h)

    # HR stacked bar chart
    hr_fig = _make_hr_chart(m, pal)
    page.paste_figure(hr_fig, CONTENT_X + half_w + 40, y, half_w, chart_h)
    y += chart_h + 36

    # ── Section divider ──────────────────────────────────────────────
    page.hline(y, x0=CONTENT_X, x1=W - MARGIN, color=BORDER, thickness=1)
    y += 20

    # ════════════════════════════════════════════════════════════════
    # ROW 2: Peer Comparison Table
    # ════════════════════════════════════════════════════════════════
    peer_label = _peer_table_title(pc, data)
    page.text(CONTENT_X, y, f"III. Peer Benchmarking  ·  {peer_label}",
              font_size=38, bold=True, color=NAVY)
    y += 56

    if insights.peer_insight:
        page.text(CONTENT_X, y, insights.peer_insight,
                  font_size=26, italic=True, color=TEAL, max_width=CONTENT_W)
    y += 40

    table_fig = _make_peer_table(data, pc, m, pal)
    page.paste_figure(table_fig, CONTENT_X, y, CONTENT_W, table_h)
    y += table_h + 20

    # ════════════════════════════════════════════════════════════════
    # FOOTER
    # ════════════════════════════════════════════════════════════════
    footer_y = H - 80
    page.hline(footer_y, x0=MARGIN, x1=W - MARGIN, color=BORDER, thickness=2)
    footer_y += 12
    page.text(MARGIN, footer_y,
              f"ERM3 V3 · riskmodels-py · {data.teo}",
              font_size=24, color=TEXT_LIGHT)
    page.text_right(W - MARGIN, footer_y,
                    "BW Macro · Confidential · Not Investment Advice",
                    font_size=24, color=TEXT_LIGHT)

    return page


# ---------------------------------------------------------------------------
# Individual chart builders — each returns a standalone go.Figure
# ---------------------------------------------------------------------------

def _make_er_chart(m: dict, pal) -> go.Figure:
    """L3 ER Decomposition horizontal bar chart."""
    labels = ["Market ER", "Sector ER", "Subsector ER", "Residual ER"]
    values = [
        float(_g(m, "l3_market_er", "l3_mkt_er") or 0) * 100,
        float(_g(m, "l3_sector_er", "l3_sec_er") or 0) * 100,
        float(_g(m, "l3_subsector_er", "l3_sub_er") or 0) * 100,
        float(_g(m, "l3_residual_er", "l3_res_er") or 0) * 100,
    ]

    fig = go.Figure(go.Bar(
        y=labels, x=values, orientation="h",
        marker=dict(color=pal.factor_colors, line=dict(width=0), cornerradius=4),
        text=[f"{v:+.1f}%" for v in values],
        textposition="outside",
        textfont=dict(family=T.fonts.family, size=12, color=pal.text_dark),
        cliponaxis=False,
    ))
    T.style(fig)
    # Pad xaxis so outside bar labels aren't clipped
    abs_max = max(abs(v) for v in values) if values else 1
    label_pad = abs_max * 0.30  # room for bar text labels
    small_pad = abs_max * 0.05  # minimal breathing room on the other side
    x_min = min(0, min(values))
    x_max = max(0, max(values))
    left_pad = label_pad if x_min < 0 else small_pad
    right_pad = label_pad if x_max > 0 else small_pad
    fig.update_layout(
        yaxis=dict(autorange="reversed", showline=False),
        xaxis=dict(
            visible=False, zeroline=False,
            range=[x_min - left_pad, x_max + right_pad],
        ),
        bargap=0.35,
    )
    return fig


def _make_hr_chart(m: dict, pal) -> go.Figure:
    """Hedge-Ratio Cascade — one stacked bar per model level (L1/L2/L3).

    Each bar = market β (bottom) + sector β (middle) + subsector β (top).
    barmode='relative' handles negative stacking correctly.
    """
    l1_mkt = float(_g(m, "l1_market_hr", "l1_mkt_hr") or 0)
    l2_mkt = float(_g(m, "l2_market_hr", "l2_mkt_hr") or 0)
    l2_sec = float(_g(m, "l2_sector_hr", "l2_sec_hr") or 0)
    l3_mkt = float(_g(m, "l3_market_hr", "l3_mkt_hr") or 0)
    l3_sec = float(_g(m, "l3_sector_hr", "l3_sec_hr") or 0)
    l3_sub = float(_g(m, "l3_subsector_hr", "l3_sub_hr") or 0)

    levels = ["L1", "L2", "L3"]

    # Market: present at all levels
    mkt_vals = [l1_mkt, l2_mkt, l3_mkt]
    mkt_labels = [f"{v:.2f}" if abs(v) > 0.005 else "" for v in mkt_vals]

    # Sector: only L2 and L3 (L1 = 0, hidden)
    sec_vals = [0.0, l2_sec, l3_sec]
    sec_labels = ["", f"{l2_sec:.2f}" if abs(l2_sec) > 0.005 else "",
                  f"{l3_sec:.2f}" if abs(l3_sec) > 0.005 else ""]

    # Subsector: only L3 (L1/L2 = 0, hidden)
    sub_vals = [0.0, 0.0, l3_sub]
    sub_labels = ["", "", f"{l3_sub:.2f}" if abs(l3_sub) > 0.005 else ""]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=levels, y=mkt_vals, name="Mkt \u03b2",
        marker=dict(color=pal.navy, line=dict(width=0)),
        text=mkt_labels, textposition="inside",
        textfont=dict(family=T.fonts.family, size=12, color="#ffffff"),
        insidetextanchor="middle",
    ))
    fig.add_trace(go.Bar(
        x=levels, y=sec_vals, name="Sec \u03b2",
        marker=dict(color=pal.teal, line=dict(width=0)),
        text=sec_labels, textposition="inside",
        textfont=dict(family=T.fonts.family, size=12, color="#ffffff"),
        insidetextanchor="middle",
    ))
    fig.add_trace(go.Bar(
        x=levels, y=sub_vals, name="Sub \u03b2",
        marker=dict(color=pal.slate, line=dict(width=0)),
        text=sub_labels, textposition="inside",
        textfont=dict(family=T.fonts.family, size=12, color="#ffffff"),
        insidetextanchor="middle",
    ))

    T.style(fig)
    fig.update_layout(
        barmode="relative",
        bargap=0.35,
        yaxis=dict(
            title="Hedge Ratio (\u03b2)",
            zeroline=True, zerolinecolor="#aaaaaa", zerolinewidth=1,
        ),
        legend=dict(
            orientation="h", yanchor="bottom", y=-0.18,
            xanchor="center", x=0.5, bgcolor="rgba(0,0,0,0)", borderwidth=0,
        ),
    )
    return fig


def _make_peer_table(data: R1Data, pc: PeerComparison | None, m: dict, pal) -> go.Figure:
    """Peer comparison table as a standalone Plotly figure."""
    fig = go.Figure(_build_peer_table_trace(data, pc, m))
    T.style(fig)
    return fig


def _peer_table_title(pc: PeerComparison | None, data: R1Data) -> str:
    if pc is not None and not pc.peer_detail.empty:
        return f"Peer Comparison  ·  {pc.peer_group_label}"
    return "Peer Comparison"


def _build_peer_table_trace(
    data: R1Data,
    pc: PeerComparison | None,
    m: dict[str, Any],
) -> go.Table:
    """Build the Plotly Table trace for peer comparison."""
    pal = T.palette
    fonts = T.fonts

    headers = ["Ticker", "Company", "Cap Wt%", "Vol (23d)", "L3 Res ER%", "vs Peer Avg", "L3 Mkt \u03b2"]

    if pc is None or pc.peer_detail.empty:
        return go.Table(
            header=dict(
                values=[f"<b>{h}</b>" for h in headers],
                fill_color=pal.navy,
                font=dict(family=fonts.family, size=fonts.table_header, color="#ffffff"),
                align="center",
                line=dict(color=pal.navy, width=1),
                height=30,
            ),
            cells=dict(
                values=[["No peer data available"]] + [[""]] * (len(headers) - 1),
                fill_color="#ffffff",
                font=dict(family=fonts.family, size=fonts.table_body, color=pal.text_mid),
                align="center",
                height=26,
            ),
        )

    # Build rows: target first, then top peers
    tickers, companies, weights, vols, res_ers, vs_avgs, mkt_betas = [], [], [], [], [], [], []

    # Target row
    target_res = pc.target_l3_residual_er
    spread = pc.selection_spread
    target_vol_raw = _g(m, "vol_23d", "volatility")
    target_company = data.company_name

    tickers.append(f"<b>\u2605 {data.ticker}</b>")
    companies.append(f"<b>{target_company}</b>")
    weights.append("—")
    vols.append(f"{float(target_vol_raw)*100:.1f}%" if target_vol_raw else "—")
    res_ers.append(T.format_pct(target_res))
    vs_avgs.append(f"{spread * 10000:+.0f} bps" if spread is not None else "—")
    mkt_betas.append(T.format_number(_g(m, "l3_market_hr", "l3_mkt_hr"), decimals=2))

    # Peer rows
    top_peers = pc.peer_detail.sort_values("weight", ascending=False).head(10)
    for t, row in top_peers.iterrows():
        p_res = row.get("l3_residual_er") if pd.notna(row.get("l3_residual_er")) else row.get("l3_res_er")
        peer_avg = pc.peer_avg_l3_residual_er
        vs_avg = None
        if p_res is not None and pd.notna(p_res) and peer_avg is not None:
            vs_avg = (float(p_res) - float(peer_avg)) * 10000

        p_vol = row.get("vol_23d")
        if p_vol is None or (hasattr(p_vol, '__float__') and pd.isna(p_vol)):
            p_var = row.get("stock_var")
            if p_var is not None and pd.notna(p_var):
                import math
                p_vol = math.sqrt(float(p_var) * 252)

        p_mkt_hr = row.get("l3_market_hr")
        if p_mkt_hr is None or (hasattr(p_mkt_hr, '__float__') and pd.isna(p_mkt_hr)):
            p_mkt_hr = row.get("l3_mkt_hr")

        cn = row.get("company_name", "")
        cn = str(cn) if cn and not (isinstance(cn, float) and pd.isna(cn)) else ""

        tickers.append(str(t))
        companies.append(cn)
        weights.append(f"{float(row.get('weight', 0)) * 100:.1f}%")
        vols.append(f"{float(p_vol)*100:.1f}%" if p_vol is not None else "—")
        res_ers.append(T.format_pct(p_res))
        vs_avgs.append(f"{vs_avg:+.0f} bps" if vs_avg is not None else "—")
        mkt_betas.append(T.format_number(p_mkt_hr, decimals=2))

    n_rows = len(tickers)
    row_fills = ["#f0f4f8" if i == 0 else ("#ffffff" if i % 2 == 1 else "#f8f9fb")
                 for i in range(n_rows)]

    return go.Table(
        columnwidth=[0.9, 2.0, 0.7, 0.7, 0.8, 0.9, 0.7],
        header=dict(
            values=[f"<b>{h}</b>" for h in headers],
            fill_color=pal.navy,
            font=dict(family=fonts.family, size=fonts.table_header, color="#ffffff"),
            align=["center", "left", "center", "center", "center", "center", "center"],
            line=dict(color=pal.navy, width=1),
            height=30,
        ),
        cells=dict(
            values=[tickers, companies, weights, vols, res_ers, vs_avgs, mkt_betas],
            fill_color=[row_fills] * 7,
            font=dict(family=fonts.family, size=fonts.table_body, color=pal.text_dark),
            align=["center", "left", "center", "center", "center", "center", "center"],
            line=dict(color=pal.axis_line, width=0.5),
            height=26,
        ),
    )


def _build_chips_list(
    data: R1Data, m: dict, pc: PeerComparison | None,
) -> list[tuple[str, str]]:
    """Return (label, value) chip pairs for the metric row."""
    def _pct(v: Any) -> str:
        return T.format_pct(v)

    def _fp(v: Any, d: int = 3) -> str:
        return T.format_number(v, decimals=d, prefix="")

    chips = [
        ("L3 Mkt \u03b2", _fp(_g(m, "l3_market_hr", "l3_mkt_hr"), 2)),
        ("L3 Sec \u03b2", _fp(_g(m, "l3_sector_hr", "l3_sec_hr"), 2)),
        ("L3 Sub \u03b2", _fp(_g(m, "l3_subsector_hr", "l3_sub_hr"), 2)),
        ("L3 Res ER (\u03b1)", _pct(_g(m, "l3_residual_er", "l3_res_er"))),
        ("Vol 23d", f"{float(_g(m, 'vol_23d', 'volatility') or 0)*100:.1f}%"),
        ("Subsector", data.subsector_label),
    ]
    if pc and pc.selection_spread is not None:
        chips.append((
            f"Spread vs {data.subsector_label}",
            f"{pc.selection_spread * 10000:+.0f} bps",
        ))
    return chips



# ---------------------------------------------------------------------------
# Public render API
# ---------------------------------------------------------------------------

def render_r1_to_pdf(data: R1Data, output_path: str | Path) -> Path:
    """Render the R1 Factor Risk Profile snapshot to a PDF file."""
    page = _compose_r1_page(data)
    return page.save(output_path)


def render_r1_to_png(data: R1Data, output_path: str | Path) -> Path:
    """Render the R1 Factor Risk Profile snapshot to a PNG file."""
    page = _compose_r1_page(data)
    return page.save(output_path)


def render_r1_to_png_bytes(data: R1Data, *, dpi: int | None = None) -> bytes:
    """Render the R1 snapshot to PNG bytes in memory.

    Returns raw PNG bytes — ideal for API responses, base64 encoding,
    or embedding in agent tool results.
    """
    page = _compose_r1_page(data)
    return page.to_png_bytes()


def render_r1_to_json(data: R1Data) -> str:
    """Serialize the R1 charts to Plotly JSON (for web embedding).

    Note: returns only the ER chart figure — use render_r1_to_png for the
    full composed page with header/insights/table.
    """
    apply_theme()
    m = data.metrics
    fig = _make_er_chart(m, T.palette)
    return fig.to_json()


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def _cli() -> None:
    """Minimal CLI for the JSON-first snapshot workflow.

    Usage::

        python -m riskmodels.snapshots.r1_risk_profile fetch NVDA -o nvda_r1.json
        python -m riskmodels.snapshots.r1_risk_profile render nvda_r1.json -f png
        python -m riskmodels.snapshots.r1_risk_profile run NVDA -f png
    """
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m riskmodels.snapshots.r1_risk_profile",
        description="R1 Factor Risk Profile — JSON-first snapshot pipeline",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Fetch data → JSON file")
    p_fetch.add_argument("ticker")
    p_fetch.add_argument("-o", "--output", default=None)

    p_render = sub.add_parser("render", help="Render JSON → PDF/PNG/JSON")
    p_render.add_argument("json_file")
    p_render.add_argument("-o", "--output", default=None)
    p_render.add_argument("-f", "--format", default="pdf", choices=["pdf", "png", "json"])

    p_run = sub.add_parser("run", help="Fetch + render in one step")
    p_run.add_argument("ticker")
    p_run.add_argument("-o", "--output", default=None)
    p_run.add_argument("-f", "--format", default="pdf", choices=["pdf", "png", "json"])
    p_run.add_argument("--json", default=None, help="Also save intermediate JSON")

    args = parser.parse_args()

    RENDERERS = {
        "pdf": render_r1_to_pdf,
        "png": render_r1_to_png,
    }

    if args.command == "fetch":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_r1(args.ticker, client)
        out = args.output or f"{args.ticker.upper()}_r1.json"
        data.to_json(out)
        print(f"✓ Saved {out}")

    elif args.command == "render":
        data = R1Data.from_json(args.json_file)
        ext = args.format
        if ext == "json":
            out = args.output or f"{data.ticker}_R1_Risk.json"
            Path(out).write_text(render_r1_to_json(data))
        else:
            out = args.output or f"{data.ticker}_R1_Risk.{ext}"
            RENDERERS[ext](data, out)
        print(f"✓ Rendered {out}")

    elif args.command == "run":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_r1(args.ticker, client)
        if args.json:
            data.to_json(args.json)
            print(f"✓ Saved {args.json}")
        ext = args.format
        if ext == "json":
            out = args.output or f"{args.ticker.upper()}_R1_Risk.json"
            Path(out).write_text(render_r1_to_json(data))
        else:
            out = args.output or f"{args.ticker.upper()}_R1_Risk.{ext}"
            RENDERERS[ext](data, out)
        print(f"✓ Rendered {out}")


if __name__ == "__main__":
    _cli()
