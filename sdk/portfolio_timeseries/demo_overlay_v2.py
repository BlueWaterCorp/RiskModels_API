"""Deliverable B — balance-sheet-format overlay demos (v2).

Conrad (July 8) asked for the overlay in a balance-sheet layout — Long / Short /
Net / Gross per ETF with a totals row — instead of the v1 single-notional list.

Per-ETF mapping from the overlay's signed short (positive = short the ETF):
  Short  = short  if short > 0 else 0
  Long   = -short if short < 0 else 0        (a negative "short" is a long ETF leg)
  Net    = Long - Short                      (positive = net long, negative = net short)
  Gross  = Long + Short = |short|

Writes demo_<name>_overlay_v2.md for Berkshire and Pershing. v1 demos are left
in place (additive).

Run:  python sdk/portfolio_timeseries/demo_overlay_v2.py
NOT a pytest module. Nothing committed.
"""

from __future__ import annotations

# --- import-order shim: pip 0.3.11 before local sdk/ shadows it --------------
import riskmodels  # noqa: E402
import sys
from pathlib import Path

_SDK = str(Path(__file__).resolve().parents[1])
if _SDK not in sys.path:
    sys.path.insert(0, _SDK)
# -----------------------------------------------------------------------------

from datetime import date

import numpy as np

from portfolio_timeseries import MarketNeutralOverlay, PortfolioTimeSeries

_HERE = Path(__file__).parent
FILERS = {"berkshire": "0001067983", "pershing": "0001336528"}


def build_overlay(client, cik):
    pts = PortfolioTimeSeries.from_cik(cik, client=client)
    snap = pts.as_of(date.today())
    if snap["dollars"].size == 0:
        raise RuntimeError("latest snapshot not yet public — empty as_of")
    overlay = MarketNeutralOverlay(snap).construct(client)
    gross_long = float(np.nansum(np.asarray(snap["dollars"].values, dtype=float)))
    report = str(snap["report_date"].values)[:10]
    avail = str(snap["available_date"].values)[:10]
    n_pos = int(np.isfinite(np.asarray(snap["dollars"].values, dtype=float)).sum())
    return overlay, gross_long, report, avail, n_pos


def _fmt(x):
    """Signed dollar with thousands separators; blank for exact zero."""
    return f"${x:,.0f}" if abs(x) > 0.5 else "—"


def render_balance_sheet(name, cik, overlay, gross_long, report, avail, n_pos):
    rows = []
    for etf, short in overlay.etf_shorts.items():
        long_amt = -short if short < 0 else 0.0
        short_amt = short if short > 0 else 0.0
        net = long_amt - short_amt          # positive = net long
        gross = long_amt + short_amt        # = |short|
        rows.append((etf, long_amt, short_amt, net, gross))
    # Sort by gross exposure, largest first.
    rows.sort(key=lambda r: -r[4])

    tot_long = sum(r[1] for r in rows)
    tot_short = sum(r[2] for r in rows)
    tot_net = tot_long - tot_short
    tot_gross = tot_long + tot_short
    leverage = tot_gross / gross_long if gross_long else float("nan")

    L = []
    L.append(f"# Overlay Balance Sheet — {name.title()} (CIK {cik})")
    L.append("")
    L.append(f"- **Report date (quarter-end):** {report}  ·  **Filed:** {avail}  ·  **Positions:** {n_pos}")
    L.append("")
    L.append("## Summary")
    L.append("")
    L.append("| Metric | Value |")
    L.append("|---|---:|")
    L.append(f"| Gross long book (disclosed 13F) | ${gross_long:,.0f} |")
    L.append(f"| Net overlay position | {_fmt(tot_net)} ({'net short' if tot_net < 0 else 'net long'}) |")
    L.append(f"| Gross overlay notional | ${tot_gross:,.0f} |")
    L.append(f"| Gross notional leverage (overlay ÷ book) | {leverage:.2f}× |")
    L.append("")
    L.append("## Overlay by ETF")
    L.append("")
    L.append("Long = long-ETF leg (from a net-negative industry loading). Short = short-ETF leg. "
             "Net is signed (positive = net long). Gross = Long + Short.")
    L.append("")
    L.append("| ETF | Long ($) | Short ($) | Net ($) | Gross ($) |")
    L.append("|---|---:|---:|---:|---:|")
    for etf, lo, sh, net, gr in rows:
        L.append(f"| {etf} | {_fmt(lo)} | {_fmt(sh)} | {_fmt(net)} | {_fmt(gr)} |")
    L.append(f"| **Total** | **${tot_long:,.0f}** | **${tot_short:,.0f}** | "
             f"**{_fmt(tot_net)}** | **${tot_gross:,.0f}** |")
    L.append("")
    L.append("_Industry-axis overlay (market + sector + subsector). Style is measurement-only "
             "and excluded by design. Residual industry exposure after overlay ≈ 0._")
    L.append("")
    return "\n".join(L)


def main():
    client = riskmodels.RiskModelsClient.from_env()
    print("riskmodels", riskmodels.__version__)
    for name, cik in FILERS.items():
        print("=" * 68)
        print(f"{name.title()} ({cik})")
        try:
            overlay, gl, report, avail, n_pos = build_overlay(client, cik)
            md = render_balance_sheet(name, cik, overlay, gl, report, avail, n_pos)
            out = _HERE / f"demo_{name}_overlay_v2.md"
            out.write_text(md)
            print(md)
            print("[written]", out)
        except Exception as e:  # noqa: BLE001
            print(f"{name} FAILED: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
