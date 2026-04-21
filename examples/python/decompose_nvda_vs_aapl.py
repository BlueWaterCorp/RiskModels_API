"""Same sector label, different trades: NVDA vs AAPL.

Two investors both want "more tech" exposure. One buys AAPL, the other NVDA.
Decomposing each position shows they bought very different things:

- AAPL tends to behave more like the broad market + idiosyncratic residual.
- NVDA carries heavier subsector (semiconductors) + sector exposure.

Run:
    RISKMODELS_API_KEY=rm_user_... python examples/python/decompose_nvda_vs_aapl.py
"""

from __future__ import annotations

from riskmodels import RiskModelsClient


def _row(body: dict) -> dict:
    exposure = body["exposure"]
    return {
        "ticker": body["ticker"],
        "market_er": exposure["market"]["er"],
        "sector_er": exposure["sector"]["er"],
        "subsector_er": exposure["subsector"]["er"],
        "residual_er": exposure["residual"]["er"],
        "market_hr": exposure["market"]["hr"],
        "sector_hr": exposure["sector"]["hr"],
        "subsector_hr": exposure["subsector"]["hr"],
        "sector_etf": exposure["sector"]["hedge_etf"],
        "subsector_etf": exposure["subsector"]["hedge_etf"],
    }


def main() -> None:
    with RiskModelsClient.from_env() as client:
        rows = [_row(client.decompose(t)) for t in ("AAPL", "NVDA")]

    header = (
        f"{'ticker':6s}  {'mkt_er':>7s}  {'sec_er':>7s}  {'sub_er':>7s}  "
        f"{'res_er':>7s}  {'sec_etf':>7s}  {'sub_etf':>7s}"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        def f(x):  # noqa: E306
            return f"{x:.2f}" if x is not None else "  --"

        print(
            f"{r['ticker']:6s}  {f(r['market_er']):>7s}  {f(r['sector_er']):>7s}  "
            f"{f(r['subsector_er']):>7s}  {f(r['residual_er']):>7s}  "
            f"{(r['sector_etf'] or '--'):>7s}  {(r['subsector_etf'] or '--'):>7s}"
        )
    print()
    print(
        "Takeaway: AAPL's explained risk leans heavier on market/residual; "
        "NVDA's leans heavier on sector/subsector. 'Tech exposure' means different "
        "things for each name."
    )


if __name__ == "__main__":
    main()
