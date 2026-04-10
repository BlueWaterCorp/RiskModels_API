"""Section II alternatives — 3 chart options for L3 Residual Alpha Quality.

Run: python -m riskmodels.snapshots.section2_alternatives META
Outputs 3 PNGs to snapshots/output/
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

OUTPUT_DIR = Path(__file__).resolve().parent / "output"

# ── Theme constants ──
NAVY = "#002a5e"
TEAL = "#006f8e"
SLATE = "#64748b"
INDIGO = "#4f46e5"
EMERALD = "#10b981"
GRAY_400 = "#9ca3af"
LIGHT_BG = "#fafbfc"


def _load_yearly_sharpes(cache_path: Path) -> list[dict]:
    """Compute Gross and L3 Residual Sharpe ratios for each trailing 252-day window."""
    with open(cache_path) as f:
        raw = json.load(f)

    # We need the full ticker-returns history — load from cache's p1 data
    # or recompute from l3_er_series if available. For a standalone script,
    # we'll use the RiskModelsClient to fetch directly.
    from riskmodels import RiskModelsClient
    from riskmodels.env import load_repo_dotenv
    load_repo_dotenv()
    ticker = raw["data"]["p1"]["ticker"]

    client = RiskModelsClient.from_env()
    df = client.get_ticker_returns(ticker, years=5)
    if df.empty:
        return []

    df = df.sort_values("date").reset_index(drop=True)

    gross = pd.to_numeric(df["returns_gross"], errors="coerce")
    er_cols = ["l3_market_er", "l3_sector_er", "l3_subsector_er"]
    if not all(c in df.columns for c in er_cols):
        return []

    mkt_er = pd.to_numeric(df["l3_market_er"], errors="coerce").fillna(0)
    sec_er = pd.to_numeric(df["l3_sector_er"], errors="coerce").fillna(0)
    sub_er = pd.to_numeric(df["l3_subsector_er"], errors="coerce").fillna(0)
    res_frac = 1.0 - mkt_er - sec_er - sub_er
    res_return = gross * res_frac

    total_days = len(gross.dropna())
    window = 252
    years_data = []

    for yr_idx in range(min(5, total_days // window)):
        end = total_days - yr_idx * window
        start = end - window
        if start < 0:
            break

        g = gross.iloc[start:end].dropna()
        r = res_return.iloc[start:end].dropna()
        if len(g) < 100:
            continue

        # Annualized Sharpe: mean / std * sqrt(252)
        g_sharpe = float(g.mean() / g.std() * math.sqrt(252)) if g.std() > 0 else 0.0
        r_sharpe = float(r.mean() / r.std() * math.sqrt(252)) if r.std() > 0 else 0.0

        # Year label from the end date
        end_date = df.iloc[end - 1]["date"] if "date" in df.columns else f"Y-{yr_idx}"
        year_str = str(end_date)[:4] if yr_idx == 0 else str(df.iloc[start]["date"])[:4]
        label = "Current" if yr_idx == 0 else year_str

        years_data.append({
            "label": label,
            "year_idx": yr_idx,
            "gross_sharpe": round(g_sharpe, 2),
            "resid_sharpe": round(r_sharpe, 2),
            "gross_vol": float(g.std() * math.sqrt(252)) * 100,
            "resid_vol": float(r.std() * math.sqrt(252)) * 100,
        })

    # Reverse so oldest is first (left-to-right chronological)
    years_data.reverse()
    return years_data


# ══════════════════════════════════════════════════════════════════════════
# OPTION 1: Signal Stability Dual Bar Chart
# ══════════════════════════════════════════════════════════════════════════

def option1_dual_bar(years_data: list[dict], ticker: str) -> go.Figure:
    """Clustered bar chart: Gross Sharpe (gray) vs L3 Residual Sharpe (teal) per year."""
    labels = [d["label"] for d in years_data]
    gross = [d["gross_sharpe"] for d in years_data]
    resid = [d["resid_sharpe"] for d in years_data]

    fig = go.Figure()

    fig.add_trace(go.Bar(
        x=labels, y=gross, name="Gross Sharpe",
        marker=dict(color=GRAY_400, cornerradius=4),
        text=[f"{v:.2f}" for v in gross],
        textposition="outside",
        textfont=dict(size=11, color=SLATE),
    ))
    fig.add_trace(go.Bar(
        x=labels, y=resid, name="L3 Residual Sharpe",
        marker=dict(color=TEAL, cornerradius=4),
        text=[f"{v:.2f}" for v in resid],
        textposition="outside",
        textfont=dict(size=11, color=NAVY),
    ))

    # Zero line
    fig.add_hline(y=0, line_width=1, line_color="#e2e8f0")

    # Annotation
    fig.add_annotation(
        xref="paper", yref="paper", x=0.5, y=1.08,
        text=f"<b>{ticker}: Gross vs L3 Residual Sharpe — Signal Stability</b>",
        showarrow=False, font=dict(size=16, color=NAVY),
    )
    fig.add_annotation(
        xref="paper", yref="paper", x=0.5, y=1.02,
        text="L3 residualization isolates execution quality from macro tailwinds",
        showarrow=False, font=dict(size=11, color=SLATE),
    )

    fig.update_layout(
        barmode="group",
        bargap=0.25, bargroupgap=0.08,
        width=900, height=500,
        margin=dict(t=80, b=40, l=50, r=30),
        plot_bgcolor=LIGHT_BG,
        paper_bgcolor="white",
        yaxis=dict(title="Annualized Sharpe Ratio", gridcolor="#e2e8f0",
                   zeroline=True, zerolinecolor="#cbd5e1"),
        xaxis=dict(title=None),
        legend=dict(orientation="h", yanchor="bottom", y=-0.15,
                    xanchor="center", x=0.5, font=dict(size=11)),
        font=dict(family="Inter, Liberation Sans, Arial"),
    )
    return fig


# ══════════════════════════════════════════════════════════════════════════
# OPTION 2: Alpha Decay Heatmap
# ══════════════════════════════════════════════════════════════════════════

def option2_heatmap(years_data: list[dict], ticker: str) -> go.Figure:
    """5×2 heatmap grid: Year × (Gross Sharpe | L3 Residual Sharpe)."""
    labels = [d["label"] for d in years_data]
    gross = [d["gross_sharpe"] for d in years_data]
    resid = [d["resid_sharpe"] for d in years_data]

    # Build 2D array: rows = years, cols = [Gross, Residual]
    z = [[g, r] for g, r in zip(gross, resid)]
    text = [[f"{g:.2f}", f"{r:.2f}"] for g, r in zip(gross, resid)]

    fig = go.Figure(go.Heatmap(
        z=z,
        x=["Gross Sharpe", "L3 Residual Sharpe"],
        y=labels,
        text=text,
        texttemplate="%{text}",
        textfont=dict(size=14, color="white"),
        colorscale=[
            [0, "#ef4444"],    # red for negative
            [0.3, "#fbbf24"],  # amber for low
            [0.5, "#e2e8f0"],  # gray for zero
            [0.7, "#34d399"],  # emerald for moderate
            [1.0, "#0f766e"],  # teal for high
        ],
        zmid=0,
        showscale=True,
        colorbar=dict(title="Sharpe", thickness=12, len=0.6),
    ))

    fig.update_layout(
        title=dict(
            text=f"<b>{ticker}: Alpha Decay Heatmap</b><br>"
                 "<span style='font-size:12px;color:#64748b'>"
                 "Color intensity reveals Beta play (Gross high, Residual low) "
                 "vs Selection play (Residual high)</span>",
            font=dict(size=16, color=NAVY),
        ),
        width=600, height=450,
        margin=dict(t=80, b=30, l=80, r=60),
        plot_bgcolor="white",
        paper_bgcolor="white",
        yaxis=dict(autorange="reversed"),
        font=dict(family="Inter, Liberation Sans, Arial"),
    )
    return fig


# ══════════════════════════════════════════════════════════════════════════
# OPTION 3: Resid vs Gross Sharpe Scatter (5-Year Path)
# ══════════════════════════════════════════════════════════════════════════

def option3_scatter_path(years_data: list[dict], ticker: str) -> go.Figure:
    """Scatter: X=Gross Sharpe, Y=L3 Residual Sharpe, 5 connected dots."""
    gross = [d["gross_sharpe"] for d in years_data]
    resid = [d["resid_sharpe"] for d in years_data]
    labels = [d["label"] for d in years_data]

    fig = go.Figure()

    # Diagonal reference: Residual = Gross (no alpha extraction)
    all_vals = gross + resid
    diag_min = min(min(all_vals, default=0) - 0.3, -0.5)
    diag_max = max(max(all_vals, default=1) + 0.3, 1.5)
    fig.add_trace(go.Scatter(
        x=[diag_min, diag_max], y=[diag_min, diag_max],
        mode="lines", showlegend=False,
        line=dict(color="#e2e8f0", width=1.5, dash="dash"),
    ))
    fig.add_annotation(
        x=diag_max * 0.7, y=diag_max * 0.7,
        text="Residual = Gross<br>(no alpha extraction)", showarrow=False,
        font=dict(size=9, color="#94a3b8"), textangle=-38,
    )

    # Quadrant shading
    fig.add_shape(type="rect", x0=diag_min, x1=0, y0=0, y1=diag_max,
                  fillcolor="rgba(16,185,129,0.06)", line_width=0)  # top-left: hidden alpha
    fig.add_annotation(xref="paper", yref="paper", x=0.05, y=0.95,
                       text="Hidden Alpha<br>(bad gross, good residual)",
                       showarrow=False, font=dict(size=9, color="#94a3b8"))

    # Connector line (trajectory)
    fig.add_trace(go.Scatter(
        x=gross, y=resid, mode="lines",
        line=dict(color=INDIGO, width=2, dash="dot"),
        showlegend=False,
    ))

    # Year dots — oldest smallest/lightest, most recent largest/boldest
    n = len(years_data)
    for i, (gv, rv, lbl) in enumerate(zip(gross, resid, labels)):
        is_current = (i == n - 1)
        size = 18 if is_current else 10 + i * 2
        opacity = 1.0 if is_current else 0.4 + i * 0.15
        color = INDIGO if is_current else "#818cf8"

        fig.add_trace(go.Scatter(
            x=[gv], y=[rv],
            mode="markers+text",
            showlegend=False,
            marker=dict(
                size=size, color=color, opacity=opacity,
                line=dict(width=2 if is_current else 1, color="#312e81"),
            ),
            text=[f"  <b>{lbl}</b>" if is_current else f"  {lbl}"],
            textposition="middle right",
            textfont=dict(size=12 if is_current else 9,
                          color=INDIGO if is_current else "#818cf8"),
        ))

    fig.update_layout(
        title=dict(
            text=f"<b>{ticker}: Residual vs Gross Sharpe — 5-Year Path</b><br>"
                 "<span style='font-size:12px;color:#64748b'>"
                 "Points above the diagonal = alpha extraction outperforming gross risk-adjusted return</span>",
            font=dict(size=16, color=NAVY),
        ),
        width=700, height=600,
        margin=dict(t=80, b=50, l=60, r=30),
        plot_bgcolor=LIGHT_BG,
        paper_bgcolor="white",
        xaxis=dict(title="Gross Sharpe Ratio", gridcolor="#e2e8f0",
                   zeroline=True, zerolinecolor="#cbd5e1"),
        yaxis=dict(title="L3 Residual Sharpe Ratio", gridcolor="#e2e8f0",
                   zeroline=True, zerolinecolor="#cbd5e1"),
        font=dict(family="Inter, Liberation Sans, Arial"),
    )
    return fig


# ══════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════

def main():
    ticker = sys.argv[1] if len(sys.argv) > 1 else "META"
    cache_path = OUTPUT_DIR / f"{ticker.upper()}_dd_cache.json"

    if not cache_path.exists():
        print(f"Cache not found: {cache_path}")
        print(f"Run: python -m riskmodels.snapshots.refine --page dd {ticker}")
        sys.exit(1)

    print(f"Computing 5-year Gross vs L3 Residual Sharpe for {ticker}...")
    years_data = _load_yearly_sharpes(cache_path)
    print(f"  Found {len(years_data)} annual windows:")
    for d in years_data:
        print(f"    {d['label']:10s}  Gross={d['gross_sharpe']:+.2f}  Resid={d['resid_sharpe']:+.2f}")

    if len(years_data) < 2:
        print("Need at least 2 years of data for these charts.")
        sys.exit(1)

    # Option 1: Dual Bar
    fig1 = option1_dual_bar(years_data, ticker)
    out1 = OUTPUT_DIR / f"{ticker}_s2_option1_dual_bar.png"
    fig1.write_image(str(out1), scale=2, engine="kaleido")
    print(f"  Option 1 → {out1}")

    # Option 2: Heatmap
    fig2 = option2_heatmap(years_data, ticker)
    out2 = OUTPUT_DIR / f"{ticker}_s2_option2_heatmap.png"
    fig2.write_image(str(out2), scale=2, engine="kaleido")
    print(f"  Option 2 → {out2}")

    # Option 3: Scatter Path
    fig3 = option3_scatter_path(years_data, ticker)
    out3 = OUTPUT_DIR / f"{ticker}_s2_option3_scatter_path.png"
    fig3.write_image(str(out3), scale=2, engine="kaleido")
    print(f"  Option 3 → {out3}")

    print("\nDone. Compare all 3 in the output directory.")


if __name__ == "__main__":
    main()
