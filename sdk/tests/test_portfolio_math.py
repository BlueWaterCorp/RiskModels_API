import pytest

from riskmodels.lineage import RiskLineage
from riskmodels.portfolio_math import analyze_batch_to_portfolio


def test_analyze_portfolio_weighted_hr():
    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l1_market_hr": 1.0,
                    "l2_market_hr": 0.8,
                    "l2_sector_hr": 0.2,
                    "l3_market_hr": 0.6,
                    "l3_sector_hr": 0.2,
                    "l3_subsector_hr": 0.05,
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
            },
            "MSFT": {
                "ticker": "MSFT",
                "status": "success",
                "full_metrics": {
                    "l1_market_hr": 0.0,
                    "l2_market_hr": 0.0,
                    "l2_sector_hr": 0.0,
                    "l3_market_hr": 0.0,
                    "l3_sector_hr": 0.0,
                    "l3_subsector_hr": 0.0,
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
            },
        },
        "_metadata": {
            "model_version": "ERM3-L3-test",
            "data_as_of": "2026-01-01",
            "factor_set_id": "SPY_uni_mc_3000",
            "universe_size": 3000,
        },
    }
    weights = {"AAPL": 0.5, "MSFT": 0.5}
    pa = analyze_batch_to_portfolio(
        body,
        weights,
        validate="off",
        response_lineage=RiskLineage(model_version="hdr"),
    )
    assert pa.portfolio_hedge_ratios["l3_market_hr"] == pytest.approx(0.3)
    assert pa.lineage.model_version == "ERM3-L3-test"


def test_analyze_portfolio_merges_hedge_ratios_when_full_metrics_hr_is_nan():
    """JSON null → None; float NaN must still be overwritten from hedge_ratios."""
    import math

    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l3_mkt_hr": float("nan"),
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
                "hedge_ratios": {"l3_market": 0.6},
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(body, {"AAPL": 1.0}, validate="off")
    assert pa.portfolio_hedge_ratios["l3_market_hr"] == pytest.approx(0.6)
    assert not math.isnan(pa.per_ticker.loc["AAPL", "l3_market_hr"])


def test_analyze_portfolio_merges_hedge_ratios_when_full_metrics_hr_missing():
    """Gateway often fills `hedge_ratios` (short keys) while full_metrics HR slots are null."""
    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l3_market_er": 0.25,
                    "l3_sector_er": 0.25,
                    "l3_subsector_er": 0.25,
                    "l3_residual_er": 0.25,
                },
                "hedge_ratios": {
                    "l1_market": 1.0,
                    "l2_market": 0.8,
                    "l2_sector": 0.2,
                    "l3_market": 0.6,
                    "l3_sector": 0.2,
                    "l3_subsector": 0.05,
                },
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(body, {"AAPL": 1.0}, validate="off")
    assert pa.portfolio_hedge_ratios["l3_market_hr"] == pytest.approx(0.6)
    assert pa.portfolio_hedge_ratios["l1_market_hr"] == pytest.approx(1.0)
