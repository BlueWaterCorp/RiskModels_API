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


def test_stale_release_session_is_caught():
    assert any("release session" in p for p in gp.check_decompose(FX["decompose"], "2026-11-06"))


def test_er_shares_must_sum_to_one():
    dec = copy.deepcopy(FX["decompose"])
    dec["exposure"]["residual"]["er"] = None
    assert any("ER" in p for p in gp.check_decompose(dec, S))


def test_zero_hedge_ratio_in_batch_is_caught():
    b = copy.deepcopy(FX["batch"])
    b["results"]["NVDA"]["hedge_ratios"]["l2_sector_hr"] = 0
    assert any("l2_sector_hr" in p for p in gp.check_batch(b, "NVDA", S))


def test_null_recommendation_is_caught():
    m = copy.deepcopy(FX["metrics"])
    m["hedge_levels"]["recommended_level"] = None
    assert any("recommended_level" in p for p in gp.check_metrics(m, S))
