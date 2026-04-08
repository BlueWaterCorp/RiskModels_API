"""Tests for CSV export methods on PortfolioAnalysis, PeerComparison, and StockContext."""

from __future__ import annotations

import csv
import io
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest

from riskmodels.lineage import RiskLineage
from riskmodels.portfolio_math import PortfolioAnalysis
from riskmodels.peer_group import PeerComparison
from riskmodels.snapshots._data import StockContext


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def portfolio_analysis() -> PortfolioAnalysis:
    per_ticker = pd.DataFrame({
        "ticker": ["AAPL", "MSFT"],
        "weight": [0.6, 0.4],
        "l3_market_er": [0.40, 0.30],
        "l3_sector_er": [0.20, 0.25],
        "l3_subsector_er": [0.15, 0.20],
        "l3_residual_er": [0.25, 0.25],
        "vol_23d": [0.35, 0.28],
    })
    return PortfolioAnalysis(
        lineage=RiskLineage(model_version="v3.1"),
        per_ticker=per_ticker,
        portfolio_hedge_ratios={"l3_market_hr": 0.95, "l3_sector_hr": 0.82},
        portfolio_l3_er_weighted_mean={"l3_market_er": 0.36, "l3_residual_er": 0.25},
        weights={"AAPL": 0.6, "MSFT": 0.4},
        errors={},
    )


@pytest.fixture
def peer_comparison(portfolio_analysis) -> PeerComparison:
    peer_detail = pd.DataFrame({
        "ticker": ["AMD", "INTC", "AVGO"],
        "weight": [0.4, 0.3, 0.3],
        "l3_residual_er": [0.30, 0.28, 0.35],
    })
    return PeerComparison(
        target_ticker="NVDA",
        peer_group_label="SOXX Subsector Peers (cap-weighted, N=3)",
        target_metrics={"l3_residual_er": 0.42, "vol_23d": 0.55},
        peer_portfolio=portfolio_analysis,
        target_l3_residual_er=0.42,
        peer_avg_l3_residual_er=0.31,
        selection_spread=0.11,
        target_vol=0.55,
        peer_avg_vol=0.30,
        peer_detail=peer_detail,
    )


@pytest.fixture
def stock_context() -> StockContext:
    history = pd.DataFrame({
        "date": pd.date_range("2025-01-01", periods=5).strftime("%Y-%m-%d").tolist(),
        "returns_gross": [0.01, -0.02, 0.015, 0.005, -0.01],
    })
    return StockContext(
        ticker="NVDA",
        company_name="NVIDIA Corp",
        teo="2025-01-05",
        universe="uni_mc_3000",
        sector_etf="XLK",
        subsector_etf="SOXX",
        metrics={"vol_23d": 0.55, "l3_mkt_er": 0.35, "l3_res_er": 0.25},
        market_cap=1.5e12,
        history=history,
    )


# ---------------------------------------------------------------------------
# PortfolioAnalysis
# ---------------------------------------------------------------------------

class TestPortfolioAnalysisCsv:
    def test_summary_dict(self, portfolio_analysis):
        d = portfolio_analysis.summary_dict()
        assert d["ticker"] == "PORTFOLIO"
        assert d["l3_market_hr"] == 0.95
        assert d["l3_market_er"] == 0.36

    def test_to_dataframe_with_summary(self, portfolio_analysis):
        df = portfolio_analysis.to_dataframe(include_summary=True)
        assert len(df) == 3  # 2 tickers + 1 summary
        assert df.iloc[-1]["ticker"] == "PORTFOLIO"

    def test_to_dataframe_without_summary(self, portfolio_analysis):
        df = portfolio_analysis.to_dataframe(include_summary=False)
        assert len(df) == 2

    def test_to_csv_string(self, portfolio_analysis):
        csv_str = portfolio_analysis.to_csv()
        assert csv_str is not None
        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) == 4  # header + 2 tickers + 1 summary
        headers = rows[0]
        assert "ticker" in headers
        assert "PORTFOLIO" in rows[-1]

    def test_to_csv_file(self, portfolio_analysis, tmp_path):
        out = tmp_path / "test_portfolio.csv"
        result = portfolio_analysis.to_csv(path=out)
        assert result is None  # writes to file
        assert out.exists()
        df = pd.read_csv(out)
        assert len(df) == 3


# ---------------------------------------------------------------------------
# PeerComparison
# ---------------------------------------------------------------------------

class TestPeerComparisonCsv:
    def test_to_dataframe(self, peer_comparison):
        df = peer_comparison.to_dataframe()
        assert len(df) == 4  # 1 target summary + 3 peers
        assert df.iloc[0]["ticker"] == "NVDA"

    def test_to_csv_string(self, peer_comparison):
        csv_str = peer_comparison.to_csv()
        assert csv_str is not None
        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) == 5  # header + 4 rows

    def test_to_csv_file(self, peer_comparison, tmp_path):
        out = tmp_path / "test_peers.csv"
        result = peer_comparison.to_csv(path=out)
        assert result is None
        assert out.exists()


# ---------------------------------------------------------------------------
# StockContext
# ---------------------------------------------------------------------------

class TestStockContextCsv:
    def test_metrics_to_csv_string(self, stock_context):
        csv_str = stock_context.metrics_to_csv()
        assert csv_str is not None
        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) == 2  # header + 1 row
        headers = rows[0]
        assert "ticker" in headers
        assert "teo" in headers
        assert "vol_23d" in headers

    def test_metrics_to_csv_file(self, stock_context, tmp_path):
        out = tmp_path / "test_metrics.csv"
        result = stock_context.metrics_to_csv(path=out)
        assert result is None
        assert out.exists()
        df = pd.read_csv(out)
        assert df.iloc[0]["ticker"] == "NVDA"
        assert df.iloc[0]["vol_23d"] == pytest.approx(0.55)

    def test_history_to_csv_string(self, stock_context):
        csv_str = stock_context.history_to_csv()
        assert csv_str is not None
        reader = csv.reader(io.StringIO(csv_str))
        rows = list(reader)
        assert len(rows) == 6  # header + 5 days

    def test_history_to_csv_none_when_empty(self):
        ctx = StockContext(
            ticker="FAKE", company_name="Fake", teo="2025-01-01",
            universe="uni", sector_etf=None, subsector_etf=None,
            metrics={}, market_cap=None, history=pd.DataFrame(),
        )
        assert ctx.history_to_csv() is None
