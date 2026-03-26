"""to_llm_context (Phase 1.2)."""

from __future__ import annotations

import pandas as pd

from riskmodels.legends import SHORT_ERM3_LEGEND
from riskmodels.lineage import RiskLineage
from riskmodels.llm import to_llm_context
from riskmodels.metadata_attach import attach_sdk_metadata
from riskmodels.portfolio_math import PortfolioAnalysis


def test_to_llm_context_dataframe_with_attrs():
    df = pd.DataFrame({"l3_market_hr": [0.5], "ticker": ["AAPL"]})
    lin = RiskLineage(model_version="ERM3-x", request_id="r1")
    attach_sdk_metadata(df, lin, kind="ticker_returns")
    out = to_llm_context(df)
    assert "ERM3-x" in out or "r1" in out
    assert "l3_market_hr" in out
    assert "ERM3 legend" in out or SHORT_ERM3_LEGEND[:40] in out


def test_to_llm_context_dict_becomes_table_and_legend():
    payload = {"l3_market_hr": 0.4, "l3_market_er": 0.3}
    out = to_llm_context(payload)
    assert "l3_market_hr" in out
    assert "ERM3 legend" in out


def test_to_llm_context_portfolio_analysis():
    lin = RiskLineage(model_version="v9")
    per = pd.DataFrame({"ticker": ["AAPL"], "l3_market_hr": [0.5]})
    attach_sdk_metadata(per, lin, kind="portfolio_per_ticker")
    pa = PortfolioAnalysis(
        lineage=lin,
        per_ticker=per,
        portfolio_hedge_ratios={"l3_market_hr": 0.5, "l3_sector_hr": 0.1},
        portfolio_l3_er_weighted_mean={"l3_market_er": 0.2},
        weights={"AAPL": 1.0},
        errors={},
    )
    out = to_llm_context(pa)
    assert "Per-ticker" in out
    assert "Portfolio hedge ratios" in out
    assert "ERM3 legend" in out
