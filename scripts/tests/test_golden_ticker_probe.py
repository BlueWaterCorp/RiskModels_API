"""Tests for scripts/audit/golden_ticker_probe.py on live NVDA responses captured 2026-11-08.

The failure cases copy the real response and change one field to the value the bug produced,
for example RMAPI-30's beta_to_spy = 0 on the XLK leg with no data-quality flag.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "audit"))

import golden_ticker_probe as gp  # noqa: E402

FX = json.loads((Path(__file__).parent / "fixtures" / "golden_probe_NVDA_20261108.json").read_text())
S = FX["session"]


def test_live_nvda_responses_pass():
    assert gp.check_hedge_basket(FX["hedge_basket"], S) == []
    assert gp.check_decompose(FX["decompose"], S) == []
    assert gp.check_metrics(FX["metrics"], S) == []
    assert gp.check_batch(FX["batch"], "NVDA", S) == []


def test_rmapi30_zero_sector_beta_is_caught():
    hb = copy.deepcopy(FX["hedge_basket"])
    hb["legs"][2]["beta_to_spy"] = 0  # what the route returned before #522
    problems = gp.check_hedge_basket(hb, S)
    assert problems and "XLK" in problems[0]


def test_null_beta_with_flag_is_accepted():
    hb = copy.deepcopy(FX["hedge_basket"])
    hb["legs"][2]["beta_to_spy"] = None
    hb["data_quality_flags"] = ["sector_link_beta_unavailable"]
    assert gp.check_hedge_basket(hb, S) == []


def test_null_beta_with_flag_for_another_leg_is_caught():
    hb = copy.deepcopy(FX["hedge_basket"])
    hb["legs"][2]["beta_to_spy"] = None
    hb["data_quality_flags"] = ["subsector_link_beta_unavailable"]
    problems = gp.check_hedge_basket(hb, S)
    assert problems and "XLK" in problems[0]


def test_stale_release_session_is_caught():
    assert any("release session" in p for p in gp.check_decompose(FX["decompose"], "2026-11-06"))


def test_er_shares_must_sum_to_one():
    dec = copy.deepcopy(FX["decompose"])
    dec["exposure"]["residual"]["er"] = 0.5
    assert any("ER" in p for p in gp.check_decompose(dec, S))


def test_decompose_contract_allows_null_er():
    dec = copy.deepcopy(FX["decompose"])
    dec["exposure"]["subsector"]["er"] = None
    assert gp.check_decompose(dec, S) == []


def test_zero_hedge_ratio_in_batch_is_caught():
    b = copy.deepcopy(FX["batch"])
    b["results"]["NVDA"]["hedge_ratios"]["l2_sector"] = 0
    assert any("l2_sector" in p for p in gp.check_batch(b, "NVDA", S))


def test_batch_requires_nonempty_hedge_ratios():
    for value in (None, {}):
        b = copy.deepcopy(FX["batch"])
        if value is None:
            del b["results"]["NVDA"]["hedge_ratios"]
        else:
            b["results"]["NVDA"]["hedge_ratios"] = value
        assert "missing or empty" in gp.check_batch(b, "NVDA", S)[0]


def test_batch_fixture_uses_public_contract_names():
    row = FX["batch"]["results"]["NVDA"]
    assert set(row["hedge_ratios"]) == {
        "l1_market", "l2_market", "l2_sector", "l3_market", "l3_sector", "l3_subsector",
    }
    assert "l1_market_hr" in row["full_metrics"]
    assert "l1_market_er" in row["full_metrics"]


def test_incomplete_deeper_levels_with_l1_recommendation_pass():
    metrics = copy.deepcopy(FX["metrics"])
    levels = metrics["hedge_levels"]
    levels["recommended_level"] = "L1"
    levels["incomplete_levels"] = ["L2", "L3"]
    levels["L2"]["sector_er"] = None
    levels["L3"]["subsector_er"] = None
    assert gp.check_metrics(metrics, S) == []


def test_recommended_incomplete_level_is_caught():
    metrics = copy.deepcopy(FX["metrics"])
    metrics["hedge_levels"]["incomplete_levels"] = ["L2"]
    assert any("recommended level L2 is incomplete" in p for p in gp.check_metrics(metrics, S))


def test_null_recommendation_is_caught():
    m = copy.deepcopy(FX["metrics"])
    m["hedge_levels"]["recommended_level"] = None
    assert any("recommended_level" in p for p in gp.check_metrics(m, S))
