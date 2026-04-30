"""Tests for riskmodels.views.agent_thumbnail helpers."""

from __future__ import annotations

import pytest

from riskmodels.views.agent_thumbnail import (
    agent_thumbnail,
    classify_residual,
    get_layer_shares,
)


DECOMPOSE = {
    "ticker": "NVDA",
    "symbol": "NVDA",
    "data_as_of": "2026-04-21",
    "teo": "2026-04-21",
    "exposure": {
        "market": {"er": 0.62, "hr": 1.10, "hedge_etf": "SPY"},
        "sector": {"er": 0.10, "hr": 0.35, "hedge_etf": "XLK"},
        "subsector": {"er": 0.10, "hr": 0.60, "hedge_etf": "SMH"},
        "residual": {"er": 0.18, "hr": None, "hedge_etf": None},
    },
    "hedge": {"SPY": -1.10, "XLK": -0.35, "SMH": -0.60},
}


def test_agent_thumbnail_decompose_matches_target_shape_and_example_line():
    out = agent_thumbnail(DECOMPOSE)
    assert set(out.keys()) == {"summary", "residual_signal", "dominant_layer", "hedge_hint", "key_numbers"}
    assert out["dominant_layer"] == "market"
    assert out["residual_signal"] == "negative"
    assert out["summary"] == "Residual drag offset strong market gains."
    assert out["hedge_hint"] == "Hedge market exposure (SPY)."
    assert pytest.approx(out["key_numbers"]["residual_share"], rel=1e-9) == 0.18
    assert pytest.approx(out["key_numbers"]["market_share"], rel=1e-9) == 0.62


def test_contr_variance_takes_priority_over_exposure():
    blended = dict(DECOMPOSE)
    blended["market_contr_variance"] = 0.1
    blended["sector_contr_variance"] = 0.1
    blended["subsector_contr_variance"] = 0.1
    blended["residual_contr_variance"] = 0.7
    out = agent_thumbnail(blended)
    assert out["dominant_layer"] == "residual"
    assert out["hedge_hint"] == "Residual risk dominates — not hedgeable."


def test_l3_wire_abbrev_aliases_use_last_aligned_row():
    body = {
        "dates": ["2026-01-01", "2026-01-02"],
        "market_factor_etf": "QQQ",
        "l3_mkt_er": [0.4, 0.5],
        "l3_sec_er": [0.2, 0.2],
        "l3_sub_er": [0.2, 0.15],
        "l3_res_er": [0.2, 0.15],
    }
    out = agent_thumbnail(body)
    assert out["dominant_layer"] == "market"
    assert out["hedge_hint"] == "Hedge market exposure (QQQ)."


def test_l3_skips_trailing_partial_rows():
    body = {
        "dates": ["a", "b", "c"],
        "l3_market_er": [0.4, float("nan"), 0.9],
        "l3_sector_er": [0.2, 0.25, float("nan")],
        "l3_subsector_er": [0.2, 0.25, 0.03],
        "l3_residual_er": [0.2, 0.25, 0.07],
    }
    shares = get_layer_shares(body)
    assert pytest.approx(shares["market"], rel=1e-9) == 0.4


def test_portfolio_variance_decomposition_scalars():
    payload = {
        "portfolio_risk_index": {
            "variance_decomposition": {"market": 0.25, "sector": 0.25, "subsector": 0.25, "residual": 0.25}
        }
    }
    out = agent_thumbnail(payload)
    assert classify_residual(out["key_numbers"]["residual_share"]) == "neutral"
    assert out["residual_signal"] == "neutral"
    assert out["dominant_layer"] == "market"


def test_get_layer_shares_raises_on_unknown_payload():
    with pytest.raises(ValueError, match="Cannot derive"):
        get_layer_shares({})
