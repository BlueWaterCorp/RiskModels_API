"""R1 Snapshot — Factor Risk Profile (Current × Stock).

The first page of the Risk suite: where is this stock's risk coming from?
Pure Matplotlib rendering via SnapshotPage — no WeasyPrint, no HTML.

Layout (Letter Landscape, 12×12 GridSpec)
------------------------------------------
  Row 0       : Header bar (title + subtitle)
  Row 1       : Chip row (L3 betas, vol, selection spread)
  Rows 2–6    : Left — L3 ER Decomposition (hbar)
              : Right — Hedge-Ratio Cascade (grouped vbar)
  Rows 7–10   : Full-width peer comparison table
  Row 11      : AI narrative text block
  Footer      : Confidential + data TEO + SDK version

Usage
-----
    from riskmodels import RiskModelsClient
    from riskmodels.snapshots import get_data_for_r1, render_r1_to_pdf

    client = RiskModelsClient()
    data   = get_data_for_r1("NVDA", client)
    data.to_json("nvda_r1.json")                  # save handshake artifact
    render_r1_to_pdf(data, "NVDA_R1_Risk.pdf")

    # Or offline:
    data = R1Data.from_json("nvda_r1.json")
    render_r1_to_pdf(data, "NVDA_R1_Risk.pdf")

Fetch/render separation
-----------------------
    get_data_for_r1()  — all API calls (StockContext + PeerGroupProxy)
    render_r1_to_pdf() — pure Matplotlib, no network calls

Requires
--------
    pip install riskmodels-py[pdf]
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")

import pandas as pd

from ..peer_group import PeerComparison, PeerGroupProxy
from ._theme import THEME


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
    teo: str                              # data as-of date (ISO string)
    universe: str
    sector_etf: str | None
    subsector_etf: str | None

    # Latest point-in-time metrics (semantic keys: l3_market_hr, vol_23d, etc.)
    metrics: dict[str, Any]

    # Peer context (None if unavailable)
    peer_comparison: PeerComparison | None = None

    # AI narrative — the "so what" paragraph
    narrative: str = ""

    sdk_version: str = "0.3.0"

    # ── Convenience ──────────────────────────────────────────────────

    @property
    def subsector_label(self) -> str:
        return self.subsector_etf or self.sector_etf or "—"

    # ── JSON serialization ───────────────────────────────────────────

    def to_json(self, path: str | Path) -> Path:
        """Serialize to JSON (the handshake artifact)."""
        from ._json_io import dump_json
        return dump_json(self, path)

    @classmethod
    def from_json(cls, path: str | Path) -> "R1Data":
        """Reconstruct R1Data from a JSON file."""
        from ._json_io import load_json

        raw = load_json(path)
        d = raw["data"]

        # Rebuild PeerComparison if present
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
            sdk_version=d.get("sdk_version", "0.3.0"),
        )


# ---------------------------------------------------------------------------
# AI Narrative generation
# ---------------------------------------------------------------------------

def _generate_narrative(data: R1Data) -> str:
    """Build a 2–3 sentence analyst narrative from the data.

    This is the "so what" a PM reads first — like a McKinsey exhibit footnote.
    Computed from the metrics + peer comparison, no LLM call required.
    """
    m = data.metrics
    pc = data.peer_comparison
    ticker = data.ticker

    # Extract key values — handle both abbreviated (API) and full key names
    def _g(full: str, abbr: str) -> Any:
        """Get metric by full name first, then abbreviated fallback."""
        return m.get(full) if m.get(full) is not None else m.get(abbr)

    res_er = _g("l3_residual_er", "l3_res_er")
    mkt_hr = _g("l3_market_hr", "l3_mkt_hr")
    vol = _g("vol_23d", "volatility")

    # Find dominant factor
    factors = {
        "market": abs(float(_g("l3_market_er", "l3_mkt_er") or 0)),
        "sector": abs(float(_g("l3_sector_er", "l3_sec_er") or 0)),
        "subsector": abs(float(_g("l3_subsector_er", "l3_sub_er") or 0)),
        "residual": abs(float(_g("l3_residual_er", "l3_res_er") or 0)),
    }
    dominant = max(factors, key=factors.get)  # type: ignore
    dominant_pct = factors[dominant] / max(sum(factors.values()), 1e-9) * 100

    parts: list[str] = []

    # Sentence 1: Peer context (headline finding)
    if pc and pc.selection_spread is not None:
        spread_bps = pc.selection_spread * 10000
        direction = "above" if spread_bps > 0 else "below"
        parts.append(
            f"{ticker}'s L3 residual alpha of "
            f"{THEME.format_pct(res_er)} places it {direction} the "
            f"{data.subsector_label} peer average by {abs(spread_bps):.0f} bps."
        )
    elif res_er is not None:
        parts.append(
            f"{ticker}'s L3 residual alpha is {THEME.format_pct(res_er)}."
        )

    # Sentence 2: Dominant risk driver
    parts.append(
        f"The dominant risk driver is {dominant} ({dominant_pct:.0f}% of total "
        f"explained variance), with market beta at "
        f"{THEME.format_number(mkt_hr, decimals=2) if mkt_hr else '—'}."
    )

    # Sentence 3: Volatility context
    if vol is not None and pc and pc.peer_avg_vol is not None:
        vol_vs = "above" if float(vol) > float(pc.peer_avg_vol) else "below"
        parts.append(
            f"Realised volatility of {float(vol) * 100:.1f}% (23d) is "
            f"{vol_vs} the peer group average of "
            f"{float(pc.peer_avg_vol) * 100:.1f}%."
        )
    elif vol is not None:
        parts.append(f"Realised volatility is {float(vol) * 100:.1f}% (23d).")

    return " ".join(parts)


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
    """Fetch everything needed for the R1 Factor Risk Profile snapshot.

    Uses the shared StockContext data layer for the target stock, then
    enriches with PeerGroupProxy for relative context.

    Parameters
    ----------
    ticker         : Stock ticker (e.g. "NVDA").
    client         : RiskModelsClient instance.
    peer_group_by  : "subsector_etf" (default) or "sector_etf".
    peer_weighting : "market_cap" (default) or "equal".
    """
    import warnings
    from ._data import fetch_stock_context

    # 1. Fetch stock context (batch analyze + returns + benchmark returns)
    ctx = fetch_stock_context(ticker, client, years=1, include_spy=False)

    # 2. Peer context — PeerGroupProxy
    # Resolve the ETF for peer grouping — prefer subsector, fall back to sector
    etf_override = ctx.subsector_etf if peer_group_by == "subsector_etf" else ctx.sector_etf

    peer_comparison: PeerComparison | None = None
    try:
        proxy = PeerGroupProxy.from_ticker(
            client, ticker,
            group_by=peer_group_by,   # type: ignore[arg-type]
            weighting=peer_weighting,  # type: ignore[arg-type]
            sector_etf_override=etf_override,
            max_peers=15,  # Top 15 by market cap — enough for table + spreads
        )
        peer_comparison = proxy.compare(client)
    except Exception as exc:
        warnings.warn(
            f"Could not build PeerGroupProxy for {ticker}: {exc}. "
            "Rendering R1 without peer context.",
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
        sdk_version=ctx.sdk_version,
    )

    # 3. Generate the AI narrative
    data.narrative = _generate_narrative(data)

    return data


# ---------------------------------------------------------------------------
# Render step — pure Matplotlib via SnapshotPage
# ---------------------------------------------------------------------------

def render_r1_to_pdf(data: R1Data, output_path: str | Path) -> Path:
    """Render the R1 Factor Risk Profile snapshot to a PDF file.

    No API calls. Pure Matplotlib. No WeasyPrint or HTML.

    Parameters
    ----------
    data        : R1Data from get_data_for_r1() or R1Data.from_json().
    output_path : Destination .pdf path.
    """
    from ._page import SnapshotPage
    from ._charts import chart_hbar, chart_grouped_vbar, chart_table

    m = data.metrics
    pc = data.peer_comparison
    pal = THEME.palette
    typ = THEME.type

    # ── Helpers ──────────────────────────────────────────────────────
    def _pct(v: Any) -> str:
        return THEME.format_pct(v)

    def _fp(v: Any, d: int = 3) -> str:
        return THEME.format_number(v, decimals=d, prefix="")

    def _g(full: str, abbr: str) -> Any:
        """Get metric by full name first, then abbreviated fallback."""
        return m.get(full) if m.get(full) is not None else m.get(abbr)

    # ── Chips ────────────────────────────────────────────────────────
    chips: list[tuple[str, str]] = [
        ("L3 Mkt β",      _fp(_g("l3_market_hr", "l3_mkt_hr"), 2)),
        ("L3 Sec β",      _fp(_g("l3_sector_hr", "l3_sec_hr"), 2)),
        ("L3 Sub β",      _fp(_g("l3_subsector_hr", "l3_sub_hr"), 2)),
        ("L3 Res ER (α)", _pct(_g("l3_residual_er", "l3_res_er"))),
        ("Vol 23d",       f"{float(_g('vol_23d', 'volatility') or 0)*100:.1f}%"),
        ("Subsector ETF", data.subsector_label),
    ]
    if pc and pc.selection_spread is not None:
        chips.append((
            f"Spread vs {data.subsector_label}",
            f"{pc.selection_spread * 10000:+.0f} bps",
        ))

    # ── Page layout ────────────────────────────────────────────────
    # 20-row grid for fine vertical control:
    #   0-1   : header + chips (rendered by SnapshotPage)
    #   2-7   : charts (ER hbar left, HR cascade right)
    #   7-8   : peer table title
    #   8-15  : peer comparison table (header + target + 6 peers = 8 rows)
    #   15-18 : narrative text block
    #   19    : footer (rendered by SnapshotPage)

    page = SnapshotPage(
        title=f"{data.ticker} — {data.company_name}",
        subtitle="R1 · Factor Risk Profile",
        ticker=data.ticker,
        teo=data.teo,
        chips=chips,
        grid_rows=20,
        grid_cols=12,
    )

    # ── Top-left: L3 ER Decomposition (rows 2–7, cols 1–6) ─────────
    ax_er = page.panel(row_slice=slice(2, 7), col_slice=slice(1, 6))

    er_labels = ["Market ER", "Sector ER", "Subsector ER", "Residual ER"]
    er_values = [
        float(_g("l3_market_er", "l3_mkt_er") or 0) * 100,
        float(_g("l3_sector_er", "l3_sec_er") or 0) * 100,
        float(_g("l3_subsector_er", "l3_sub_er") or 0) * 100,
        float(_g("l3_residual_er", "l3_res_er") or 0) * 100,
    ]
    chart_hbar(
        ax_er, er_labels, er_values,
        colors=pal.factor_colors,
        title="L3 Explained-Return Attribution",
        value_fmt="{:+.1f}%",
    )

    # ── Top-right: HR Cascade (rows 2–7, cols 7–12) ────────────────
    ax_hr = page.panel(row_slice=slice(2, 7), col_slice=slice(7, 12))

    l1_mkt = float(_g("l1_market_hr", "l1_mkt_hr") or 0)
    l2_mkt = float(_g("l2_market_hr", "l2_mkt_hr") or 0)
    l2_sec = float(_g("l2_sector_hr", "l2_sec_hr") or 0)
    l3_mkt = float(_g("l3_market_hr", "l3_mkt_hr") or 0)
    l3_sec = float(_g("l3_sector_hr", "l3_sec_hr") or 0)
    l3_sub = float(_g("l3_subsector_hr", "l3_sub_hr") or 0)

    chart_grouped_vbar(
        ax_hr,
        group_labels=["L1", "L2", "L3"],
        series={
            "Mkt β": [l1_mkt, l2_mkt, l3_mkt],
            "Sec β": [0.0, l2_sec, l3_sec],
            "Sub β": [0.0, 0.0, l3_sub],
        },
        colors=[pal.navy, pal.teal, pal.slate],
        title="Hedge-Ratio Cascade  ·  L1 / L2 / L3",
        value_fmt="{:.2f}",
        ylabel="Hedge Ratio (β)",
    )
    # Pad Y-axis so value labels don't clip at panel edges
    all_hr = [l1_mkt, l2_mkt, l2_sec, l3_mkt, l3_sec, l3_sub]
    y_max = max(max(all_hr), 1.0) * 1.22
    y_min = min(min(all_hr), 0) * 1.15
    ax_hr.set_ylim(y_min, y_max)

    # ── Peer table title + table ───────────────────────────────────────
    if pc is not None and not pc.peer_detail.empty:
        # Title in its own dedicated row so it can't be overlapped
        ax_tbl_title = page.panel(row_slice=slice(7, 8), col_slice=slice(0, 12))
        ax_tbl_title.axis("off")
        ax_tbl_title.text(
            0.0, 0.2,
            f"Peer Comparison  ·  {pc.peer_group_label}",
            fontsize=typ.panel_title,
            fontweight="bold",
            color=pal.navy,
            va="bottom", ha="left",
            fontfamily=typ.family,
            transform=ax_tbl_title.transAxes,
        )

        # Table panel — rows 8–15 (7 grid rows for 8-row table)
        ax_tbl = page.panel(row_slice=slice(8, 15), col_slice=slice(0, 12))

        headers = ["Ticker", "Cap Wt%", "Vol (23d)", "L3 Res ER%", "vs Peer Avg", "L3 Mkt β"]
        rows: list[list[str]] = []

        target_res = pc.target_l3_residual_er
        spread = pc.selection_spread
        target_vol_raw = _g("vol_23d", "volatility")
        target_vol_str = f"{float(target_vol_raw)*100:.1f}%" if target_vol_raw is not None else "—"
        rows.append([
            f"★ {data.ticker}",
            "—",
            target_vol_str,
            _pct(target_res),
            f"{spread * 10000:+.0f} bps" if spread is not None else "—",
            _fp(_g("l3_market_hr", "l3_mkt_hr"), 2),
        ])

        top_peers = pc.peer_detail.sort_values("weight", ascending=False).head(6)
        for t, row in top_peers.iterrows():
            p_res = row.get("l3_residual_er") if pd.notna(row.get("l3_residual_er")) else row.get("l3_res_er")
            peer_avg = pc.peer_avg_l3_residual_er
            vs_avg = None
            if p_res is not None and pd.notna(p_res) and peer_avg is not None:
                vs_avg = (float(p_res) - float(peer_avg)) * 10000

            # Derive vol from stock_var if vol_23d is missing
            p_vol = row.get("vol_23d")
            if p_vol is None or (hasattr(p_vol, '__float__') and pd.isna(p_vol)):
                p_var = row.get("stock_var")
                if p_var is not None and pd.notna(p_var):
                    import math
                    p_vol = math.sqrt(float(p_var) * 252)

            # Derive l3_market_hr from l3_mkt_hr if needed
            p_mkt_hr = row.get("l3_market_hr")
            if p_mkt_hr is None or (hasattr(p_mkt_hr, '__float__') and pd.isna(p_mkt_hr)):
                p_mkt_hr = row.get("l3_mkt_hr")

            rows.append([
                str(t),
                f"{float(row.get('weight', 0)) * 100:.1f}%",
                f"{float(p_vol)*100:.1f}%" if p_vol is not None else "—",
                _pct(p_res),
                f"{vs_avg:+.0f} bps" if vs_avg is not None else "—",
                _fp(p_mkt_hr, 2),
            ])

        chart_table(
            ax_tbl, rows, headers,
            title="",
            highlight_col=0,
        )
    else:
        ax_tbl = page.panel(row_slice=slice(8, 15), col_slice=slice(0, 12))
        ax_tbl.axis("off")
        ax_tbl.text(
            0.5, 0.5,
            "Peer comparison unavailable — subsector_etf not resolved for this ticker.",
            ha="center", va="center",
            fontsize=typ.body,
            color=pal.text_mid,
            style="italic",
        )

    # ── Narrative text block (rows 15–18) ────────────────────────────
    if data.narrative:
        ax_nar = page.panel(row_slice=slice(15, 18), col_slice=slice(0, 12))
        ax_nar.axis("off")

        sentences = data.narrative.split(". ", 1)
        lead = sentences[0] + "." if sentences else ""
        rest = sentences[1] if len(sentences) > 1 else ""

        # Lead sentence — bold, navy
        ax_nar.text(
            0.01, 0.85, lead,
            fontsize=typ.body + 0.5,
            fontweight="bold",
            color=pal.navy,
            va="top", ha="left",
            wrap=True,
            fontfamily=typ.family,
            transform=ax_nar.transAxes,
        )

        # Supporting text — regular weight
        if rest:
            ax_nar.text(
                0.01, 0.35, rest,
                fontsize=typ.body,
                color=pal.text_dark,
                va="top", ha="left",
                wrap=True,
                fontfamily=typ.family,
                transform=ax_nar.transAxes,
            )

    # ── Save ─────────────────────────────────────────────────────────
    return page.save(output_path)


# ---------------------------------------------------------------------------
# CLI entrypoint — python -m riskmodels.snapshots.r1_risk_profile fetch|render
# ---------------------------------------------------------------------------

def _cli() -> None:
    """Minimal CLI for the JSON-first snapshot workflow.

    Usage::

        # Step 1: fetch data (needs API key)
        python -m riskmodels.snapshots.r1_risk_profile fetch NVDA -o nvda_r1.json

        # Step 2: render PDF (offline, no API needed)
        python -m riskmodels.snapshots.r1_risk_profile render nvda_r1.json -o NVDA_R1.pdf

        # One-shot (fetch + render)
        python -m riskmodels.snapshots.r1_risk_profile run NVDA -o NVDA_R1.pdf
    """
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m riskmodels.snapshots.r1_risk_profile",
        description="R1 Factor Risk Profile — JSON-first snapshot pipeline",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # fetch
    p_fetch = sub.add_parser("fetch", help="Fetch data → JSON file")
    p_fetch.add_argument("ticker", help="Stock ticker (e.g. NVDA)")
    p_fetch.add_argument("-o", "--output", default=None,
                         help="Output JSON path (default: {TICKER}_r1.json)")

    # render
    p_render = sub.add_parser("render", help="Render JSON → PDF file")
    p_render.add_argument("json_file", help="Input JSON file from 'fetch'")
    p_render.add_argument("-o", "--output", default=None,
                          help="Output PDF path (default: {TICKER}_R1_Risk.pdf)")

    # run (one-shot)
    p_run = sub.add_parser("run", help="Fetch + render in one step")
    p_run.add_argument("ticker", help="Stock ticker (e.g. NVDA)")
    p_run.add_argument("-o", "--output", default=None, help="Output PDF path")
    p_run.add_argument("--json", default=None, help="Also save intermediate JSON")

    args = parser.parse_args()

    if args.command == "fetch":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_r1(args.ticker, client)
        out = args.output or f"{args.ticker.upper()}_r1.json"
        data.to_json(out)
        print(f"✓ Saved {out}")

    elif args.command == "render":
        data = R1Data.from_json(args.json_file)
        out = args.output or f"{data.ticker}_R1_Risk.pdf"
        render_r1_to_pdf(data, out)
        print(f"✓ Rendered {out}")

    elif args.command == "run":
        from riskmodels import RiskModelsClient
        client = RiskModelsClient()
        data = get_data_for_r1(args.ticker, client)
        if args.json:
            data.to_json(args.json)
            print(f"✓ Saved {args.json}")
        out = args.output or f"{args.ticker.upper()}_R1_Risk.pdf"
        render_r1_to_pdf(data, out)
        print(f"✓ Rendered {out}")


if __name__ == "__main__":
    _cli()
