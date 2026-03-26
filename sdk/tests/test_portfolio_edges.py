"""normalize_positions and portfolio edge cases (§2B)."""

from __future__ import annotations

import pytest

from riskmodels.lineage import RiskLineage
from riskmodels.portfolio_math import analyze_batch_to_portfolio, normalize_positions


def test_normalize_positions_empty_raises():
    with pytest.raises(ValueError, match="empty"):
        normalize_positions({})


def test_normalize_positions_negative_weights_renormalize_to_simplex():
    w = normalize_positions({"AAPL": -1.0, "MSFT": 3.0})
    assert abs(sum(w.values()) - 1.0) < 1e-9
    assert w["AAPL"] < w["MSFT"]


def test_normalize_positions_zero_sum_weights_equal_split():
    w = normalize_positions({"AAPL": -1.0, "MSFT": 1.0})
    assert len(w) == 2
    assert w["AAPL"] == pytest.approx(0.5)
    assert w["MSFT"] == pytest.approx(0.5)


def test_analyze_portfolio_with_negative_position_weights_succeeds():
    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l3_market_hr": 0.5,
                    "l3_sector_hr": 0.1,
                    "l3_subsector_hr": 0.0,
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(
        body,
        {"AAPL": -2.0, "MSFT": 4.0},
        validate="off",
        response_lineage=RiskLineage(),
    )
    assert not pa.per_ticker.empty
