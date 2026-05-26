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


def test_analyze_portfolio_wire_v3_hr_keys_normalize_for_weighted_mean():
    """Batch JSON uses V3 wire keys (l3_mkt_hr, …); SDK maps to semantic names for PHR."""
    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "full_metrics": {
                    "l3_mkt_hr": 0.1,
                    "l3_sec_hr": 0.2,
                    "l3_sub_hr": 0.3,
                },
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(body, {"AAPL": 1.0}, validate="off")
    assert pa.portfolio_hedge_ratios["l3_market_hr"] == pytest.approx(0.1)
    assert pa.portfolio_hedge_ratios["l3_sector_hr"] == pytest.approx(0.2)
    assert pa.portfolio_hedge_ratios["l3_subsector_hr"] == pytest.approx(0.3)


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


def test_analyze_portfolio_hedge_ratios_only_without_full_metrics():
    """metrics=['hedge_ratios'] batch rows carry hedge_levels but omit full_metrics."""
    body = {
        "results": {
            "AAPL": {
                "ticker": "AAPL",
                "status": "success",
                "hedge_ratios": {
                    "l3_market": 0.6,
                    "l3_sector": 0.2,
                    "l3_subsector": 0.05,
                },
                "hedge_levels": {
                    "L1": {
                        "market_hr": -0.86,
                        "sector_hr": None,
                        "subsector_hr": None,
                        "market_er": 0.4,
                        "sector_er": None,
                        "subsector_er": None,
                        "residual_er": 0.6,
                        "hedge_etfs": {"market": "SPY", "sector": None, "subsector": None},
                    },
                    "L2": {
                        "market_hr": -1.4,
                        "sector_hr": 0.35,
                        "subsector_hr": None,
                        "market_er": 0.35,
                        "sector_er": 0.01,
                        "subsector_er": None,
                        "residual_er": 0.64,
                        "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": None},
                    },
                    "L3": {
                        "market_hr": 0.6,
                        "sector_hr": 0.2,
                        "subsector_hr": 0.05,
                        "market_er": 0.31,
                        "sector_er": 0.02,
                        "subsector_er": 0.02,
                        "residual_er": 0.65,
                        "hedge_etfs": {"market": "SPY", "sector": "XLK", "subsector": "SOXX"},
                    },
                },
            },
        },
        "_metadata": {},
    }
    pa = analyze_batch_to_portfolio(body, {"AAPL": 1.0}, validate="off")
    assert "AAPL" not in pa.errors
    assert pa.portfolio_hedge_ratios["l3_market_hr"] == pytest.approx(0.6)
    assert pa.portfolio_hedge_levels is not None
    assert pa.portfolio_hedge_levels["L3"]["market_hr"] == pytest.approx(0.6)
