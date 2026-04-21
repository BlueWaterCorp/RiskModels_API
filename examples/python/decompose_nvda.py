"""Decompose NVDA into four additive ERM3 bets and print the hedge map.

Usage:
    RISKMODELS_API_KEY=rm_user_... python examples/python/decompose_nvda.py

Prints the four-layer exposure (market, sector, subsector, residual) and the
top-level `hedge` map (ETF -> dollar ratio). Each tradable layer maps to one
ETF; residual is stock-specific and not tradable.
"""

from __future__ import annotations

from riskmodels import RiskModelsClient


def main() -> None:
    with RiskModelsClient.from_env() as client:
        body = client.decompose("NVDA")
        print(f"Ticker:     {body['ticker']}")
        print(f"As of:      {body['data_as_of']}")
        print()
        print("Exposure (four additive bets):")
        for name in ("market", "sector", "subsector", "residual"):
            layer = body["exposure"][name]
            er = layer["er"]
            hr = layer["hr"]
            etf = layer["hedge_etf"]
            er_s = f"{er:.2f}" if er is not None else "  --"
            hr_s = f"{hr:+.2f}" if hr is not None else "  --"
            etf_s = etf or "(residual)"
            print(f"  {name:10s}  er={er_s}  hr={hr_s}  -> {etf_s}")
        print()
        print("Hedge map (short the ETF at |ratio| per $1 of stock):")
        for etf, ratio in body["hedge"].items():
            print(f"  {etf:6s}  {ratio:+.2f}")


if __name__ == "__main__":
    main()
