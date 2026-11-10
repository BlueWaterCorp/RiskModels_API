"""get_alpha: scale a hedge-basket response to a signal. Fixtures are real production responses (stat_arb, 2026-11-09)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from riskmodels import AlphaUnavailable, RiskModelsClient, alpha_legs

FIX = Path(__file__).parent / "fixtures"


def _basket(name: str) -> dict:
    return json.loads((FIX / name).read_text())


def test_buy_scales_each_leg_by_its_ratio():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    legs = {leg.symbol: leg for leg in alpha_legs(b, "buy", 1_000_000)}
    assert set(legs) == {"NVDA", "SPY", "XLK"}
    assert legs["NVDA"].dollars == pytest.approx(1_000_000)
    for sym in ("SPY", "XLK"):
        ratio = next(x["position"] for x in b["legs"] if x["leg"] == sym)
        assert legs[sym].dollars == pytest.approx(1_000_000 * ratio)
        assert legs[sym].side == "short"
    assert legs["NVDA"].side == "long"


def test_sell_flips_every_leg():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    buy = {leg.symbol: leg.dollars for leg in alpha_legs(b, "buy", 250_000)}
    sell = {leg.symbol: leg.dollars for leg in alpha_legs(b, "sell", 250_000)}
    assert {k: -v for k, v in buy.items()} == pytest.approx(sell)


def test_net_market_beta_of_scaled_legs_matches_response():
    # sum of dollars x beta_to_spy per dollar of stock should reproduce net_market_beta_after_hedge (about zero at L2)
    b = _basket("hedge_basket_CAT_2026-11-09.json")
    legs = alpha_legs(b, "buy", 1.0)
    betas = {x["leg"]: x["beta_to_spy"] for x in b["legs"]}
    net = sum(leg.dollars * betas[leg.symbol] for leg in legs)
    assert net == pytest.approx(b["net_market_beta_after_hedge"], abs=1e-6)


def test_shares_round_toward_zero_with_prices():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    prices = {"NVDA": 200.0, "SPY": 600.0, "XLK": 300.0}
    legs = {leg.symbol: leg for leg in alpha_legs(b, "sell", 100_000, prices)}
    assert legs["NVDA"].shares == -500.0
    xlk = next(x["position"] for x in b["legs"] if x["leg"] == "XLK")
    assert legs["XLK"].shares == float(math.trunc(-100_000 * xlk / 300.0))
    frac = {leg.symbol: leg for leg in alpha_legs(b, "buy", 100_000, prices, whole_shares=False)}
    assert frac["SPY"].shares == pytest.approx(100_000 * b["legs"][1]["position"] / 600.0)


def test_missing_price_raises():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    with pytest.raises(AlphaUnavailable):
        alpha_legs(b, "buy", 1000, {"NVDA": 100.0})


def test_incomplete_level_raises():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    b["incomplete_levels"] = [b["recommended_hedge_level"]]
    with pytest.raises(AlphaUnavailable):
        alpha_legs(b, "buy", 1000)


def test_null_position_raises():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    b["legs"][2]["position"] = None
    with pytest.raises(AlphaUnavailable):
        alpha_legs(b, "buy", 1000)


@pytest.mark.parametrize("direction,dollars", [("hold", 100), ("buy", 0), ("buy", -5), ("buy", float("nan"))])
def test_bad_arguments(direction, dollars):
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    with pytest.raises(ValueError):
        alpha_legs(b, direction, dollars)


def test_client_get_alpha_calls_hedge_basket_route(monkeypatch):
    b = _basket("hedge_basket_CAT_2026-11-09.json")
    client = RiskModelsClient(api_key="rm_agent_live_abc")
    seen = {}

    def fake_request(method, path, params=None, **kw):
        seen.update(method=method, path=path, params=params)
        return b, None, None

    monkeypatch.setattr(client._transport, "request", fake_request)
    legs = client.get_alpha("cat", "buy", 10_000, user_segment="ls_equity")
    assert seen == {"method": "GET", "path": "/hedge-basket/CAT", "params": {"user_segment": "ls_equity"}}
    assert legs[0].symbol == "CAT" and legs[0].dollars == pytest.approx(10_000)


def test_depth_recommended_equals_stored_level_ratios():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    rec = {leg.symbol: leg.dollars for leg in alpha_legs(b, "buy", 1000)}
    chosen = {leg.symbol: leg.dollars for leg in alpha_legs(b, "buy", 1000, depth=b["recommended_hedge_level"])}
    assert rec == pytest.approx(chosen)


def test_depth_lstar_uses_stored_level_without_cap():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    b["lstar"] = "L3"  # stored L* deeper than the recommended level
    lstar = {leg.symbol: leg.dollars for leg in alpha_legs(b, "buy", 1_000_000, depth="lstar")}
    assert set(lstar) == {"NVDA", "SPY", "XLK", "SMH"}
    rec = {leg.symbol for leg in alpha_legs(b, "buy", 1_000_000)}
    assert rec == {"NVDA", "SPY", "XLK"}


@pytest.mark.parametrize("level,etfs", [("L1", {"SPY"}), ("L2", {"SPY", "XLK"}), ("L3", {"SPY", "XLK", "SMH"})])
def test_depth_chosen_directly(level, etfs):
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    legs = alpha_legs(b, "buy", 1_000_000, depth=level)
    assert {leg.symbol for leg in legs} == {"NVDA"} | etfs
    assert legs[0].symbol == "NVDA" and legs[0].dollars == pytest.approx(1_000_000)
    hl = b["hedge_levels"][level]
    assert next(x for x in legs if x.symbol == "SPY").dollars == pytest.approx(1_000_000 * hl["market_hr"])


def test_depth_signed_sector_leg_at_l3_keeps_its_sign():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    xlk = next(x for x in alpha_legs(b, "buy", 1_000_000, depth="L3") if x.symbol == "XLK")
    assert xlk.dollars > 0 and xlk.side == "long"


def test_bad_depth_and_unavailable_level():
    b = _basket("hedge_basket_NVDA_2026-11-09.json")
    with pytest.raises(ValueError):
        alpha_legs(b, "buy", 1000, depth="L4")
    b["hedge_levels"]["incomplete_levels"] = ["L3"]
    with pytest.raises(AlphaUnavailable):
        alpha_legs(b, "buy", 1000, depth="L3")
