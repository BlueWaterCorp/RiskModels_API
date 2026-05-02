"""Live smoke test for the AOM portfolio chain.

Runs the canonical YC-demo 10-name portfolio through:
    risk_decomposition -> hedge_action

against the live /api/snapshot endpoint. Prints latency, the variance
decomposition, the largest residual contributor, and that name's hedge ratios.

Requires: RISKMODELS_API_KEY in the environment.
Usage:
    python scripts/smoke_aom_portfolio_chain.py
"""

from __future__ import annotations

import os
import sys
import time

from riskmodels import rm, run
from riskmodels.aom import analyze, hedge_action
from riskmodels.aom.builder import portfolio_inline
from riskmodels.client import RiskModelsClient


PORTFOLIO = [
    {"ticker": "TSLA", "weight": 0.20},
    {"ticker": "NVDA", "weight": 0.15},
    {"ticker": "XOM", "weight": 0.10},
    {"ticker": "AAPL", "weight": 0.10},
    {"ticker": "MSFT", "weight": 0.10},
    {"ticker": "GOOGL", "weight": 0.10},
    {"ticker": "META", "weight": 0.08},
    {"ticker": "AMZN", "weight": 0.07},
    {"ticker": "JPM", "weight": 0.05},
    {"ticker": "COST", "weight": 0.05},
]


def main() -> int:
    if not os.environ.get("RISKMODELS_API_KEY"):
        print("error: RISKMODELS_API_KEY not set", file=sys.stderr)
        return 2

    client = RiskModelsClient.from_env()

    req = (
        rm()
        .subject(portfolio_inline(PORTFOLIO))
        .scope(date_range_preset="ytd", as_of="latest")
        .chain(
            analyze(lens="risk_decomposition", resolution="full_stack", view="snapshot"),
            hedge_action(depends_on="previous"),
        )
        .structured()
    )

    t0 = time.monotonic()
    out = run(client, req)
    dt = time.monotonic() - t0

    if out["errors"]:
        print(f"FAIL ({dt:.2f}s) — errors:")
        for e in out["errors"]:
            print(f"  {e}")
        return 1

    fetch = out["steps_out"][1]
    body = fetch["result"][0] if isinstance(fetch.get("result"), tuple) else fetch.get("result")
    snap = body["snapshot"]
    vd = snap["variance_decomposition"]
    positions = snap["positions"]

    largest_res = max(positions, key=lambda p: abs(p.get("l3_res_er") or 0))

    print(f"OK ({dt:.2f}s)")
    print(f"as_of: {snap['as_of']}  lookback_days: {snap['lookback_trading_days']}")
    print(
        "variance_decomposition: "
        f"market={vd['market']:.3f} sector={vd['sector']:.3f} "
        f"subsector={vd['subsector']:.3f} residual={vd['residual']:.3f}"
    )
    print(
        f"largest residual contributor: {largest_res['ticker']} "
        f"(weight={largest_res['weight']:.1%}, "
        f"l3_res_er={largest_res.get('l3_res_er')})"
    )
    print(
        f"hedge ratios for {largest_res['ticker']}: "
        f"mkt_hr={largest_res.get('l3_mkt_hr')} "
        f"sec_hr={largest_res.get('l3_sec_hr')} "
        f"sub_hr={largest_res.get('l3_sub_hr')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
