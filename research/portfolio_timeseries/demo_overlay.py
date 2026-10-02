"""Demo — market-neutral ETF overlay on a live 13F long book.

Run:  PYTHONPATH=sdk python sdk/portfolio_timeseries/demo_overlay.py [CIK]
Default CIK is Berkshire (0001067983). Also stress-tests Pershing Square.

Builds the real overlay: pull the filer's latest disclosed holdings, decompose
each position on the industry axis (market + sector + subsector), net the ETF
hedges via n_leg_hedge, and print the dollar shorts that flatten the book's
factor exposure. Writes a reference table to demo_<name>_overlay.md.

NOT a pytest module; safe to run standalone. Nothing is committed.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np

from portfolio_timeseries import MarketNeutralOverlay, PortfolioTimeSeries
from riskmodels import RiskModelsClient

_HERE = Path(__file__).parent

FILERS = {
    "berkshire": "0001067983",
    "pershing": "0001336528",
}


def build_overlay(client, cik: str):
    pts = PortfolioTimeSeries.from_cik(cik, client=client)
    snap = pts.as_of(date.today())
    if snap["dollars"].size == 0:
        raise RuntimeError("latest snapshot not yet public — empty as_of")
    overlay = MarketNeutralOverlay(snap).construct(client)
    return pts, snap, overlay


def gross_long(snap) -> float:
    d = np.asarray(snap["dollars"].values, dtype=float)
    return float(np.nansum(d))


def render_md(name, cik, pts, snap, overlay) -> str:
    gl = gross_long(snap)
    report = str(snap["report_date"].values)[:10]
    avail = str(snap["available_date"].values)[:10]
    n_pos = int(np.isfinite(np.asarray(snap["dollars"].values, dtype=float)).sum())

    shorts = sorted(overlay.etf_shorts.items(), key=lambda kv: -abs(kv[1]))
    total_short = sum(overlay.etf_shorts.values())

    lines = []
    lines.append(f"# Market-Neutral Overlay — {name.title()} (CIK {cik})")
    lines.append("")
    lines.append(f"- **Report date (quarter-end):** {report}")
    lines.append(f"- **Available date (13F filed):** {avail}")
    lines.append(f"- **Disclosed long positions:** {n_pos}")
    lines.append(f"- **Gross long (disclosed adj_mv):** ${gl:,.0f}")
    lines.append(f"- **Concentration:** HHI {pts.concentration('hhi'):.4f} · "
                 f"top-5 {pts.concentration('top_n', 5):.1%}")
    lines.append("")
    lines.append("## ETF shorts to neutralize market / sector / subsector exposure")
    lines.append("")
    lines.append("Positive = short the ETF; negative = go long (a net-negative "
                 "industry loading). Computed as Σ(dollars × per-dollar hedge ratio) "
                 "netted across every position by `n_leg_hedge`.")
    lines.append("")
    lines.append("| ETF | Notional | % of gross long |")
    lines.append("|-----|---------:|----------------:|")
    for etf, amt in shorts:
        lines.append(f"| {etf} | ${amt:,.0f} | {amt / gl:+.2%} |")
    lines.append(f"| **Net** | **${total_short:,.0f}** | **{total_short / gl:+.2%}** |")
    lines.append("")
    resid = {k: v for k, v in overlay.residual_exposure.items() if abs(v) > 1e-6}
    lines.append(f"Residual (un-hedged) exposure entries: {len(resid)} "
                 f"(0 expected — every industry factor maps to an ETF).")
    lines.append("")
    lines.append("_Style is measurement-only (`hedgeable: false`) and is excluded "
                 "from the overlay by design; hedging is on the industry axis._")
    lines.append("")
    return "\n".join(lines)


def main():
    cik = sys.argv[1] if len(sys.argv) > 1 else FILERS["berkshire"]
    client = RiskModelsClient.from_env()

    print("=" * 72)
    print(f"PRIMARY overlay — CIK {cik}")
    print("=" * 72)
    pts, snap, overlay = build_overlay(client, cik)
    name = "berkshire" if cik == FILERS["berkshire"] else cik
    md = render_md(name, cik, pts, snap, overlay)
    print(md)
    out = _HERE / f"demo_{name}_overlay.md"
    out.write_text(md)
    print(f"\n[written] {out}")

    # Step I — stress-test a smaller, more concentrated book (Pershing).
    if cik == FILERS["berkshire"]:
        print("\n" + "=" * 72)
        print("STRESS-TEST overlay — Pershing Square (CIK 0001336528)")
        print("=" * 72)
        try:
            p_pts, p_snap, p_overlay = build_overlay(client, FILERS["pershing"])
            p_md = render_md("pershing", FILERS["pershing"], p_pts, p_snap, p_overlay)
            print(p_md)
            (_HERE / "demo_pershing_overlay.md").write_text(p_md)
            print(f"\n[written] {_HERE / 'demo_pershing_overlay.md'}")
        except Exception as e:  # noqa: BLE001
            print(f"Pershing overlay FAILED: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
