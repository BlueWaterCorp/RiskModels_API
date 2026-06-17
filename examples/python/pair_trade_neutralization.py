"""Neutralize a long/short pair's factor risk across four ERM3 levels.

Usage:
    RISKMODELS_API_KEY=rm_user_... python examples/python/pair_trade_neutralization.py

Builds a dollar-neutral INTC (long) / AMD (short) pair and prints the hedge
trades at four progressively deeper levels — naive, L1 (market), L2 (+sector),
L3 (+subsector) — plus the leverage-cap-aware recommended level. INTC and AMD
share a sector (XLK) and subsector (SMH), so each deeper level adds one ETF leg.
"""

from __future__ import annotations

from riskmodels import RiskModelsClient


def main() -> None:
    with RiskModelsClient.from_env() as client:
        pn = client.pair_trade_neutralization("INTC", "AMD", 10_000)

        print(f"Pair:         long {pn.long_ticker} / short {pn.short_ticker}")
        print(f"Per leg:      ${pn.dollars:,.0f}")
        print(f"As of:        {pn.as_of}")
        print(f"Leverage cap: {pn.leverage_cap:.2f}x (on hedge-overlay gross)")
        print(f"Recommended:  {pn.recommended_level}")
        print()

        print("Four-level comparison:")
        for lvl in pn.levels:
            star = "  <- recommended" if lvl.level == pn.recommended_level else ""
            cap = "ok" if lvl.within_leverage_cap else "OVER"
            print(
                f"  {lvl.level:5s}  {lvl.label:38s}  "
                f"gross={lvl.gross_leverage:.2f}x  "
                f"overlay={lvl.hedge_overlay_gross:.2f}x ({cap}){star}"
            )
        print()

        print(f"Recommended trade legs — {pn.recommended_level}:")
        for leg in pn.recommended.legs:
            print(f"  {leg.side:5s} {leg.ticker:6s}  {leg.role:5s}  ${leg.dollars:>12,.2f}")


if __name__ == "__main__":
    main()
