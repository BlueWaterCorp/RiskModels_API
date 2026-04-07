"""S1 Snapshot — Forensic Deep-Dive (Current × Stock).

The simplest quadrant: one stock, latest metrics, enriched with peer context.

Layout (Letter Landscape)
--------------------------
  Header strip  : ticker, company name, subsector ETF, data TEO
  Chip bar      : key metrics + selection spread (Navy highlight)
  Top row
    Left panel  : L3 ER stacked bar — Market / Sector / Subsector / Residual
    Right panel : Hedge ratio cascade — L1→L2→L3 grouped bars
  Bottom row (full-width)
    Peer comparison table — target vs. each peer: Vol, L3 Res ER, spread

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots import get_data_for_s1, render_s1_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_s1("NVDA", client)
    render_s1_to_pdf(data, "NVDA_S1_Forensic.pdf")

Fetch/render separation
-----------------------
    get_data_for_s1()  — all API calls happen here (RiskModelsClient + PeerGroupProxy)
    render_s1_to_pdf() — pure Matplotlib + Jinja2, no network calls

Requires
--------
    pip install riskmodels-py[pdf]
"""

from __future__ import annotations

import base64
import datetime
import json
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as mticker
import numpy as np

from ..peer_group import PeerComparison, PeerGroupProxy
from ..visuals.styles import (
    CN_NAVY, CN_TEAL, CN_SLATE, CN_GREEN, CN_ORANGE, CN_GRAY, CN_LIGHT_BG,
    CN_L3_LAYER_COLORS,
)
from ._base_template import BASE_HTML

# ---------------------------------------------------------------------------
# Data contract
# ---------------------------------------------------------------------------

@dataclass
class S1Data:
    """All data needed to render the S1 Forensic snapshot.

    Produced by get_data_for_s1(). Consumed by render_s1_to_pdf().
    No API calls happen after this object is created.
    """
    ticker: str
    company_name: str
    teo: str                              # data as-of date (ISO string)
    universe: str
    metrics: dict[str, Any]              # normalized full_metrics (semantic keys)
    meta: dict[str, Any]                 # symbol-level metadata (sector_etf, subsector_etf, …)
    peer_comparison: PeerComparison | None = None
    sdk_version: str = "0.3.0"

    # ── JSON serialization ──────────────────────────────────────────

    def to_json(self, path: str | Path) -> Path:
        """Serialize this S1Data to a JSON file (the handshake artifact).

        Usage::

            data = get_data_for_s1("NVDA", client)
            data.to_json("nvda_s1.json")       # fetch once
            # later, offline:
            data2 = S1Data.from_json("nvda_s1.json")
            render_s1_to_pdf(data2, "NVDA_S1.pdf")
        """
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "S1Data":
        """Reconstruct S1Data from a JSON file produced by ``to_json()``.

        PeerComparison is rebuilt as a lightweight dict-backed object
        sufficient for rendering (no live API connection needed).
        """
        import pandas as pd
        from ._json_io import load_json

        raw = load_json(path)
        d = raw["data"]

        # Rebuild PeerComparison if present
        pc = None
        pc_raw = d.get("peer_comparison")
        if pc_raw is not None:
            # Rebuild peer_detail as DataFrame
            peer_detail_records = pc_raw.get("peer_detail", [])
            peer_detail_df = pd.DataFrame(peer_detail_records)
            if not peer_detail_df.empty and "ticker" in peer_detail_df.columns:
                peer_detail_df = peer_detail_df.set_index("ticker")

            # Rebuild PortfolioAnalysis as a minimal namespace
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
            metrics=d["metrics"],
            meta=d["meta"],
            peer_comparison=pc,
            sdk_version=d.get("sdk_version", "0.3.0"),
        )


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------

def get_data_for_s1(
    ticker: str,
    client: Any,
    *,
    peer_group_by: str = "subsector_etf",
    peer_weighting: str = "market_cap",
) -> S1Data:
    """Fetch everything needed for the S1 Forensic Deep-Dive snapshot.

    Makes 2+N API calls:
      1. GET /api/metrics/{ticker}          → latest L3 metrics + meta
      2. GET /api/tickers?include_metadata  → universe for peer discovery
      3. GET /api/metrics/{peer}            × N peers (cap-weighting)
      4. POST /api/batch/analyze            → peer portfolio aggregation

    Parameters
    ----------
    ticker         : Stock ticker (e.g. "NVDA").
    client         : RiskModelsClient instance.
    peer_group_by  : "subsector_etf" (default) or "sector_etf".
    peer_weighting : "market_cap" (default) or "equal".
    """
    import warnings

    # 1. Target metrics
    snap_df = client.get_metrics(ticker, as_dataframe=True)
    if snap_df.empty:
        raise ValueError(f"No metrics returned for {ticker}")

    row = snap_df.iloc[0].to_dict()
    teo = str(row.get("teo") or row.get("date") or "N/A")[:10]
    meta = {
        k: row.get(k)
        for k in ["symbol", "ticker", "sector_etf", "subsector_etf", "name", "universe"]
    }
    company_name = str(meta.get("name") or ticker)
    universe = str(row.get("universe") or "uni_mc_3000")

    # 2. Peer context — PeerGroupProxy (the key enrichment for S1)
    peer_comparison: PeerComparison | None = None
    try:
        proxy = PeerGroupProxy.from_ticker(
            client,
            ticker,
            group_by=peer_group_by,  # type: ignore[arg-type]
            weighting=peer_weighting,  # type: ignore[arg-type]
        )
        peer_comparison = proxy.compare(client)
    except Exception as exc:
        warnings.warn(
            f"Could not build PeerGroupProxy for {ticker}: {exc}. "
            "Rendering S1 without peer context.",
            UserWarning,
            stacklevel=2,
        )

    return S1Data(
        ticker=ticker.upper(),
        company_name=company_name,
        teo=teo,
        universe=universe,
        metrics=row,
        meta=meta,
        peer_comparison=peer_comparison,
    )


# ---------------------------------------------------------------------------
# Chart builders (Matplotlib → base64 PNG)
# ---------------------------------------------------------------------------

def _chart_l3_er_bars(metrics: dict[str, Any], ticker: str) -> str:
    """Left panel: horizontal stacked L3 ER bar (Market/Sector/Subsector/Residual)."""
    fig, ax = plt.subplots(figsize=(5.5, 4.0))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.set_facecolor("white")

    components = [
        ("Market ER",    "l3_market_er",    CN_NAVY),
        ("Sector ER",    "l3_sector_er",    CN_TEAL),
        ("Subsector ER", "l3_subsector_er", CN_SLATE),
        ("Residual ER",  "l3_residual_er",  CN_GREEN),
    ]
    labels = [c[0] for c in components]
    values = [float(metrics.get(c[1]) or 0) * 100 for c in components]
    colors = [c[2] for c in components]

    bars = ax.barh(labels, values, color=colors, height=0.55, edgecolor="white", linewidth=0.5)

    for bar, val in zip(bars, values):
        offset = 0.8 if val >= 0 else -0.8
        ha = "left" if val >= 0 else "right"
        ax.text(
            val + offset, bar.get_y() + bar.get_height() / 2,
            f"{val:+.1f}%", va="center", ha=ha,
            fontsize=8, color=CN_NAVY, fontweight="bold",
        )

    ax.axvline(0, color=CN_GRAY, linewidth=0.8)
    ax.set_xlabel("Annualised ER (%)", fontsize=8, color=CN_GRAY)
    ax.set_title(f"{ticker}  ·  L3 Explained-Return Decomposition", fontsize=10,
                 color=CN_NAVY, fontweight="bold", pad=8)
    ax.grid(True, axis="x", linestyle="--", linewidth=0.4, alpha=0.5)
    for spine in ("top", "right"): ax.spines[spine].set_visible(False)
    ax.tick_params(labelsize=8)

    plt.tight_layout(pad=1.2)
    return _fig_to_b64(fig)


def _chart_hr_cascade(metrics: dict[str, Any], ticker: str) -> str:
    """Right panel: L1→L2→L3 hedge ratio grouped bar cascade."""
    fig, ax = plt.subplots(figsize=(5.5, 4.0))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.set_facecolor("white")

    hr_data = [
        ("L1", [("Mkt β", metrics.get("l1_market_hr"), CN_NAVY)]),
        ("L2", [
            ("Mkt β",  metrics.get("l2_market_hr"), CN_NAVY),
            ("Sec β",  metrics.get("l2_sector_hr"),  CN_TEAL),
        ]),
        ("L3", [
            ("Mkt β",  metrics.get("l3_market_hr"),    CN_NAVY),
            ("Sec β",  metrics.get("l3_sector_hr"),     CN_TEAL),
            ("Sub β",  metrics.get("l3_subsector_hr"),  CN_SLATE),
        ]),
    ]

    x = 0.0
    xtick_pos, xtick_lbl = [], []
    for level, items in hr_data:
        xs = []
        for i, (lbl, val, col) in enumerate(items):
            v = float(val) if val is not None else 0.0
            ax.bar(x + i, v, color=col, width=0.72, edgecolor="white", linewidth=0.4)
            ax.text(x + i, v + (0.02 if v >= 0 else -0.05),
                    f"{v:.3f}", ha="center",
                    va="bottom" if v >= 0 else "top",
                    fontsize=6.5, color=CN_NAVY, fontweight="bold")
            xs.append(x + i)
        xtick_pos.append(np.mean(xs))
        xtick_lbl.append(level)
        x += len(items) + 0.8

    ax.axhline(0, color=CN_GRAY, linewidth=0.8)
    ax.set_xticks(xtick_pos)
    ax.set_xticklabels(xtick_lbl, fontsize=11, fontweight="bold", color=CN_NAVY)
    ax.set_ylabel("Hedge Ratio (β)", fontsize=8, color=CN_GRAY)
    ax.set_title(f"{ticker}  ·  L1 / L2 / L3 Hedge-Ratio Cascade", fontsize=10,
                 color=CN_NAVY, fontweight="bold", pad=8)
    ax.grid(True, axis="y", linestyle="--", linewidth=0.4, alpha=0.5)
    for spine in ("top", "right"): ax.spines[spine].set_visible(False)

    legend_els = [
        mpatches.Patch(color=CN_NAVY,  label="Market β"),
        mpatches.Patch(color=CN_TEAL,  label="Sector β"),
        mpatches.Patch(color=CN_SLATE, label="Subsector β"),
    ]
    ax.legend(handles=legend_els, fontsize=7, loc="upper right")
    plt.tight_layout(pad=1.2)
    return _fig_to_b64(fig)


def _chart_peer_table(comparison: PeerComparison, ticker: str) -> str:
    """Bottom row: peer comparison table — target vs top-N peers."""
    import pandas as pd

    fig, ax = plt.subplots(figsize=(11.0, 2.8))
    fig.patch.set_facecolor(CN_LIGHT_BG)
    ax.axis("off")

    per_ticker: pd.DataFrame = comparison.peer_detail
    col_headers = ["Ticker", "Cap Wt%", "Vol (23d)", "L3 Res ER%", "vs Peer Avg", "L3 Mkt β"]

    rows: list[list[str]] = []

    def _pct(v: Any) -> str:
        try: return f"{float(v) * 100:+.2f}%" if v is not None else "—"
        except Exception: return "—"

    def _fp(v: Any, fmt: str = ".3f") -> str:
        try: return format(float(v), fmt) if v is not None else "—"
        except Exception: return "—"

    peer_avg_res = comparison.peer_avg_l3_residual_er

    # Target row first
    m = comparison.target_metrics
    target_res = comparison.target_l3_residual_er
    spread = comparison.selection_spread
    rows.append([
        f"★ {ticker}",
        "—",
        _fp(m.get("vol_23d"), ".4f"),
        _pct(target_res),
        (f"{spread:+.2f}%" if spread is not None else "—"),
        _fp(m.get("l3_market_hr")),
    ])

    # Peer rows (top 10 by weight)
    if not per_ticker.empty:
        top_peers = per_ticker.sort_values("weight", ascending=False).head(10)
        for t, peer_row in top_peers.iterrows():
            p_res = peer_row.get("l3_residual_er")
            vs_avg = (float(p_res) - float(peer_avg_res)) if (p_res is not None and peer_avg_res is not None) else None
            rows.append([
                str(t),
                f"{float(peer_row.get('weight', 0)) * 100:.1f}%",
                _fp(peer_row.get("vol_23d"), ".4f"),
                _pct(p_res),
                (f"{vs_avg:+.2f}%" if vs_avg is not None else "—"),
                _fp(peer_row.get("l3_market_hr")),
            ])

    tbl = ax.table(cellText=rows, colLabels=col_headers, cellLoc="center", loc="center")
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7.5)
    tbl.scale(1, 1.5)

    for j in range(len(col_headers)):
        tbl[0, j].set_facecolor(CN_NAVY)
        tbl[0, j].set_text_props(color="white", fontweight="bold")

    # Target row shading
    for j in range(len(col_headers)):
        tbl[1, j].set_facecolor("#eef2f7")
        tbl[1, j].set_text_props(fontweight="bold")

    for i in range(2, len(rows) + 1):
        for j in range(len(col_headers)):
            tbl[i, j].set_facecolor("white" if i % 2 == 0 else "#f8fafc")

    plt.tight_layout(pad=0.5)
    return _fig_to_b64(fig)


def _fig_to_b64(fig: Any) -> str:
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=300, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Render step
# ---------------------------------------------------------------------------

def render_s1_to_pdf(data: S1Data, output_path: str | Path) -> Path:
    """Render the S1 Forensic snapshot to a PDF file.

    No API calls. Pure Matplotlib + Jinja2 + WeasyPrint.

    Parameters
    ----------
    data        : S1Data from get_data_for_s1().
    output_path : Destination .pdf path.
    """
    try:
        from jinja2 import Template
        from weasyprint import HTML
    except ImportError as e:
        raise ImportError(
            "PDF rendering requires weasyprint and jinja2. "
            "Install with: pip install riskmodels-py[pdf]"
        ) from e

    m = data.metrics
    pc = data.peer_comparison

    # ── Build charts ────────────────────────────────────────────────
    chart_er  = _chart_l3_er_bars(m, data.ticker)
    chart_hr  = _chart_hr_cascade(m, data.ticker)
    chart_peer = _chart_peer_table(pc, data.ticker) if pc else None

    # ── Metric chips ─────────────────────────────────────────────────
    def _pct(v: Any) -> str:
        try: return f"{float(v) * 100:+.2f}%" if v is not None else "—"
        except Exception: return "—"

    def _fp(v: Any, fmt: str = ".3f") -> str:
        try: return format(float(v), fmt) if v is not None else "—"
        except Exception: return "—"

    subsector = data.meta.get("subsector_etf") or data.meta.get("sector_etf") or "—"
    sector    = data.meta.get("sector_etf") or "—"

    chips = [
        {"lbl": "L3 Mkt β",        "val": _fp(m.get("l3_market_hr"))},
        {"lbl": "L3 Sec β",         "val": _fp(m.get("l3_sector_hr"))},
        {"lbl": "L3 Sub β",         "val": _fp(m.get("l3_subsector_hr"))},
        {"lbl": "L3 Res ER (α)",    "val": _pct(m.get("l3_residual_er"))},
        {"lbl": "L3 Mkt ER",        "val": _pct(m.get("l3_market_er"))},
        {"lbl": "Vol 23d",          "val": _fp(m.get("vol_23d"), ".4f")},
        {"lbl": "Sector ETF",       "val": sector},
        {"lbl": "Subsector ETF",    "val": subsector},
        {"lbl": "Data TEO",         "val": data.teo},
    ]

    # Peer selection spread chip (Navy highlight)
    peer_chip = None
    if pc and pc.selection_spread is not None:
        spread_pct = pc.selection_spread * 100
        peer_chip = {
            "val": f"{spread_pct:+.2f}%",
            "lbl": f"Selection Spread vs {subsector}",
        }

    # ── Subtitle ─────────────────────────────────────────────────────
    subtitle = f"{data.company_name}  ·  {subsector}  ·  L1/L2/L3 Risk Decomposition"
    peer_label = pc.peer_group_label if pc else "No peer context"

    # ── Body HTML ────────────────────────────────────────────────────
    quadrant_html = f"""
<div class="quadrant-grid">
  <div class="quadrant-row">
    <div class="quadrant">
      <div class="quadrant-title">L3 Explained-Return Attribution  ·  Latest Snapshot</div>
      <img src="data:image/png;base64,{chart_er}" alt="L3 ER Bars">
    </div>
    <div class="quadrant">
      <div class="quadrant-title">Hedge-Ratio Cascade  ·  L1 / L2 / L3</div>
      <img src="data:image/png;base64,{chart_hr}" alt="HR Cascade">
    </div>
  </div>
  {"" if chart_peer is None else f'''
  <div class="quadrant full-width">
    <div class="quadrant-title">Peer Comparison  ·  {peer_label}</div>
    <img src="data:image/png;base64,{chart_peer}" alt="Peer Table">
  </div>
  '''}
</div>
"""

    # ── Render ───────────────────────────────────────────────────────
    html_str = Template(BASE_HTML).render(
        ticker=data.ticker,
        report_title="S1  ·  Forensic Deep-Dive",
        subtitle=subtitle,
        data_date=data.teo,
        gen_date=datetime.date.today().isoformat(),
        universe=data.universe,
        confidential=True,
        chips=chips,
        peer_chip=peer_chip,
        body_html=quadrant_html,
        sdk_version=data.sdk_version,
    )

    out = Path(output_path)
    HTML(string=html_str).write_pdf(str(out))
    return out


# ---------------------------------------------------------------------------
# CLI entrypoint — python -m riskmodels.snapshots.s1_forensic fetch|render
# ---------------------------------------------------------------------------

def _cli() -> None:
    """Minimal CLI for the JSON-first snapshot workflow.

    Usage::

        # Step 1: fetch data (needs API key)
        python -m riskmodels.snapshots.s1_forensic fetch NVDA -o nvda_s1.json

        # Step 2: render PDF (offline, no API needed)
        python -m riskmodels.snapshots.s1_forensic render nvda_s1.json -o NVDA_S1.pdf

        # One-shot (fetch + render)
        python -m riskmodels.snapshots.s1_forensic run NVDA -o NVDA_S1.pdf
    """
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        prog="python -m riskmodels.snapshots.s1_forensic",
        description="S1 Forensic Deep-Dive — JSON-first snapshot pipeline",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # fetch
    p_fetch = sub.add_parser("fetch", help="Fetch data → JSON file")
    p_fetch.add_argument("ticker", help="Stock ticker (e.g. NVDA)")
    p_fetch.add_argument("-o", "--output", default=None, help="Output JSON path (default: {TICKER}_s1.json)")

    # render
    p_render = sub.add_parser("render", help="Render JSON → PDF file")
    p_render.add_argument("json_file", help="Input JSON file from 'fetch'")
    p_render.add_argument("-o", "--output", default=None, help="Output PDF path (default: {TICKER}_S1_Forensic.pdf)")

    # run (one-shot)
    p_run = sub.add_parser("run", help="Fetch + render in one step")
    p_run.add_argument("ticker", help="Stock ticker (e.g. NVDA)")
    p_run.add_argument("-o", "--output", default=None, help="Output PDF path")
    p_run.add_argument("--json", default=None, help="Also save intermediate JSON")

    args = parser.parse_args()

    if args.command == "fetch":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_s1(args.ticker, client)
        out = args.output or f"{args.ticker.upper()}_s1.json"
        data.to_json(out)
        print(f"✓ Saved {out}")

    elif args.command == "render":
        data = S1Data.from_json(args.json_file)
        out = args.output or f"{data.ticker}_S1_Forensic.pdf"
        render_s1_to_pdf(data, out)
        print(f"✓ Rendered {out}")

    elif args.command == "run":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_s1(args.ticker, client)
        if args.json:
            data.to_json(args.json)
            print(f"✓ Saved {args.json}")
        out = args.output or f"{args.ticker.upper()}_S1_Forensic.pdf"
        render_s1_to_pdf(data, out)
        print(f"✓ Rendered {out}")


if __name__ == "__main__":
    _cli()
