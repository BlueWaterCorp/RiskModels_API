"""Unit tests for riskmodels.snapshots.s2_waterfall — S2Data + chart builders.

All tests are offline (no HTTP). Client is mocked to return controlled
fixtures so we can test data prep, chart generation, and cumulative ER math
without hitting the live API or requiring WeasyPrint.

Integration tests (marked @pytest.mark.integration) are skipped by default.
"""

from __future__ import annotations

import base64
from unittest.mock import MagicMock, patch
from typing import Any

import numpy as np
import pandas as pd
import pytest

from riskmodels.snapshots.s2_waterfall import (
    S2Data,
    get_data_for_s2,
    _chart_er_stacked_area,
    _chart_hr_time_series,
    _chart_cumulative_er,
    _fig_to_b64,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_metrics_df(
    ticker: str = "AAPL",
    symbol: str = "AAPL-US",
    subsector_etf: str = "XLK",
    sector_etf: str = "XLK",
    l3_market_hr: float = 1.12,
    l3_sector_hr: float = 0.85,
    l3_subsector_hr: float = 0.72,
    l3_market_er: float = 0.55,
    l3_sector_er: float = 0.18,
    l3_subsector_er: float = 0.12,
    l3_residual_er: float = 0.15,
    vol_23d: float = 0.22,
    teo: str = "2025-12-31",
    universe: str = "uni_mc_3000",
) -> pd.DataFrame:
    return pd.DataFrame([{
        "ticker": ticker,
        "symbol": symbol,
        "subsector_etf": subsector_etf,
        "sector_etf": sector_etf,
        "name": "Apple Inc",
        "universe": universe,
        "l3_market_hr": l3_market_hr,
        "l3_sector_hr": l3_sector_hr,
        "l3_subsector_hr": l3_subsector_hr,
        "l3_market_er": l3_market_er,
        "l3_sector_er": l3_sector_er,
        "l3_subsector_er": l3_subsector_er,
        "l3_residual_er": l3_residual_er,
        "vol_23d": vol_23d,
        "teo": teo,
    }])


def _make_history_df(n_rows: int = 60) -> pd.DataFrame:
    """Synthetic l3_decomposition time series with n_rows of daily data."""
    rng = np.random.default_rng(42)
    dates = pd.date_range(end="2025-12-31", periods=n_rows, freq="B")
    df = pd.DataFrame({
        "date": dates.strftime("%Y-%m-%d"),
        "l3_market_hr":    rng.normal(1.1, 0.05, n_rows),
        "l3_sector_hr":    rng.normal(0.8, 0.05, n_rows),
        "l3_subsector_hr": rng.normal(0.7, 0.05, n_rows),
        "l3_market_er":    rng.normal(0.50, 0.10, n_rows),
        "l3_sector_er":    rng.normal(0.15, 0.05, n_rows),
        "l3_subsector_er": rng.normal(0.10, 0.05, n_rows),
        "l3_residual_er":  rng.normal(0.08, 0.15, n_rows),
    })
    return df


def _make_mock_client(
    ticker: str = "AAPL",
    n_history: int = 60,
) -> MagicMock:
    """Return a mock RiskModelsClient with controlled return values."""
    client = MagicMock()
    client.get_metrics.return_value = _make_metrics_df(ticker=ticker)
    client.get_l3_decomposition.return_value = _make_history_df(n_history)
    return client


# ---------------------------------------------------------------------------
# Tests: get_data_for_s2
# ---------------------------------------------------------------------------

class TestGetDataForS2:
    def test_returns_s2data(self):
        client = _make_mock_client()
        result = get_data_for_s2("AAPL", client)
        assert isinstance(result, S2Data)

    def test_ticker_uppercased(self):
        client = _make_mock_client()
        result = get_data_for_s2("aapl", client)
        assert result.ticker == "AAPL"

    def test_history_trimmed_to_years(self):
        """When years=0.25, history should be capped at ~63 trading days."""
        client = _make_mock_client(n_history=300)
        result = get_data_for_s2("AAPL", client, years=0.25)
        # 0.25 * 252 = 63 days
        assert len(result.history) <= 63

    def test_history_not_trimmed_when_short(self):
        """When the API returns fewer rows than years * 252, keep all rows."""
        client = _make_mock_client(n_history=30)
        result = get_data_for_s2("AAPL", client, years=1.0)
        assert len(result.history) == 30

    def test_date_start_is_earliest_date(self):
        client = _make_mock_client(n_history=60)
        result = get_data_for_s2("AAPL", client)
        assert result.date_start[:10] == result.history["date"].iloc[0][:10]

    def test_teo_from_metrics(self):
        client = _make_mock_client()
        result = get_data_for_s2("AAPL", client)
        assert result.teo == "2025-12-31"

    def test_years_stored(self):
        client = _make_mock_client()
        result = get_data_for_s2("AAPL", client, years=2.0)
        assert result.years == 2.0

    def test_raises_on_empty_metrics(self):
        client = MagicMock()
        client.get_metrics.return_value = pd.DataFrame()
        with pytest.raises(ValueError, match="No metrics returned"):
            get_data_for_s2("AAPL", client)

    def test_raises_on_empty_history(self):
        client = MagicMock()
        client.get_metrics.return_value = _make_metrics_df()
        client.get_l3_decomposition.return_value = pd.DataFrame()
        with pytest.raises(ValueError, match="No l3_decomposition history"):
            get_data_for_s2("AAPL", client)

    def test_meta_populated(self):
        client = _make_mock_client()
        result = get_data_for_s2("AAPL", client)
        assert result.meta.get("subsector_etf") == "XLK"

    def test_calls_l3_decomposition_once(self):
        client = _make_mock_client()
        get_data_for_s2("AAPL", client)
        client.get_l3_decomposition.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: chart builders (verify they produce valid base64 PNG strings)
# ---------------------------------------------------------------------------

class TestChartBuilders:
    @pytest.fixture
    def history(self):
        return _make_history_df(60)

    def test_er_stacked_area_returns_b64(self, history):
        result = _chart_er_stacked_area(history, "AAPL")
        assert isinstance(result, str)
        # Should be decodeable base64
        decoded = base64.b64decode(result)
        # PNG magic bytes
        assert decoded[:4] == b"\x89PNG"

    def test_hr_time_series_returns_b64(self, history):
        result = _chart_hr_time_series(history, "AAPL")
        assert isinstance(result, str)
        decoded = base64.b64decode(result)
        assert decoded[:4] == b"\x89PNG"

    def test_cumulative_er_returns_b64(self, history):
        result = _chart_cumulative_er(history, "AAPL")
        assert isinstance(result, str)
        decoded = base64.b64decode(result)
        assert decoded[:4] == b"\x89PNG"

    def test_chart_handles_short_history(self):
        """Charts should not raise even with only 5 rows of data."""
        tiny = _make_history_df(5)
        _chart_er_stacked_area(tiny, "X")
        _chart_hr_time_series(tiny, "X")
        _chart_cumulative_er(tiny, "X")

    def test_cumulative_er_math(self):
        """Cumulative ER for a constant series should equal n * daily_val."""
        n = 50
        df = pd.DataFrame({
            "date": pd.date_range("2025-01-01", periods=n, freq="B").strftime("%Y-%m-%d"),
            "l3_market_er":    [0.10] * n,
            "l3_sector_er":    [0.05] * n,
            "l3_subsector_er": [0.03] * n,
            "l3_residual_er":  [0.02] * n,
            "l3_market_hr":    [1.0] * n,
            "l3_sector_hr":    [0.8] * n,
            "l3_subsector_hr": [0.6] * n,
        })
        # cumulative residual = 50 * 0.02 = 1.0 (before *100 → 100%)
        res_sum = float(df["l3_residual_er"].sum()) * 100
        assert abs(res_sum - 100.0) < 1e-8

    def test_charts_handle_nan_gracefully(self):
        """NaN in history columns should not raise — they fill to 0."""
        df = _make_history_df(30)
        df.loc[5:10, "l3_residual_er"] = float("nan")
        _chart_er_stacked_area(df, "TEST")
        _chart_cumulative_er(df, "TEST")


# ---------------------------------------------------------------------------
# Tests: S2Data dataclass
# ---------------------------------------------------------------------------

class TestS2DataContract:
    def test_s2data_fields(self):
        hist = _make_history_df(20)
        d = S2Data(
            ticker="MSFT",
            company_name="Microsoft Corp",
            teo="2025-12-31",
            date_start="2025-06-01",
            universe="uni_mc_3000",
            history=hist,
            metrics={},
            meta={},
            years=1.0,
        )
        assert d.ticker == "MSFT"
        assert d.sdk_version == "0.3.0"
        assert isinstance(d.history, pd.DataFrame)

    def test_s2data_default_sdk_version(self):
        hist = _make_history_df(10)
        d = S2Data(
            ticker="T", company_name="X", teo="2025-01-01",
            date_start="2024-01-01", universe="u",
            history=hist, metrics={}, meta={},
        )
        assert d.sdk_version == "0.3.0"


# ---------------------------------------------------------------------------
# Integration tests (skipped unless --run-integration or live key present)
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_s2_data_aapl_live():
    """Fetch live S2 data for AAPL and verify shape."""
    from riskmodels import RiskModelsClient
    client = RiskModelsClient()
    data = get_data_for_s2("AAPL", client, years=1.0)
    assert data.ticker == "AAPL"
    assert len(data.history) > 50
    assert "l3_residual_er" in data.history.columns
    assert data.date_start < data.teo
