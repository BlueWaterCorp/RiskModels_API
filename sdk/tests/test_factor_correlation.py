"""Tests for factor correlation endpoints."""

import httpx
import pytest

from riskmodels import RiskModelsClient, to_llm_context
from riskmodels.legends import COMBINED_ERM3_MACRO_LEGEND
from riskmodels.parsing import factor_correlation_batch_item_to_row, factor_correlation_body_to_row


def test_factor_correlation_body_to_row():
    row = factor_correlation_body_to_row(
        {
            "ticker": "AAPL",
            "return_type": "l3_residual",
            "window_days": 126,
            "method": "pearson",
            "correlations": {"bitcoin": 0.1, "vix": -0.2},
            "overlap_days": 120,
            "warnings": ["a", "b"],
        }
    )
    assert row["ticker"] == "AAPL"
    assert row["macro_corr_bitcoin"] == 0.1
    assert row["macro_corr_vix"] == -0.2
    assert row["macro_return_type"] == "l3_residual"
    assert row["macro_window_days"] == 126
    assert row["macro_warnings"] == "a; b"


def test_factor_correlation_batch_item_to_row_error():
    row = factor_correlation_batch_item_to_row(
        {"ticker": "ZZZ", "error": "not found", "status": 404}
    )
    assert row["macro_batch_error"] == "not found"
    assert row["macro_batch_status"] == 404


def test_get_factor_correlation_single_as_dataframe():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "ticker": "AAPL",
                "return_type": "l3_residual",
                "window_days": 252,
                "method": "pearson",
                "correlations": {"vix": 0.4},
                "overlap_days": 250,
                "warnings": [],
                "_metadata": {"model_version": "3.0", "data_as_of": "2026-01-01"},
                "_agent": {},
            },
        )

    transport = httpx.MockTransport(handler)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    df = client.get_factor_correlation_single("AAPL", as_dataframe=True)
    assert df.attrs.get("legend") == COMBINED_ERM3_MACRO_LEGEND
    assert df.attrs.get("riskmodels_kind") == "macro_correlation"
    assert df["macro_corr_vix"].iloc[0] == 0.4
    assert "macro_return_type" in df.columns


def test_get_metrics_with_macro_correlation_concat():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/correlation" in url:
            return httpx.Response(
                200,
                json={
                    "ticker": "NVDA",
                    "return_type": "l3_residual",
                    "window_days": 252,
                    "method": "pearson",
                    "correlations": {"bitcoin": 0.05},
                    "overlap_days": 200,
                    "warnings": [],
                    "_metadata": {},
                    "_agent": {},
                },
            )
        return httpx.Response(
            200,
            json={
                "ticker": "NVDA",
                "metrics": {
                    "l3_mkt_hr": 1.0,
                    "l3_sec_hr": 0.1,
                    "l3_sub_hr": 0.05,
                    "l3_mkt_er": 0.3,
                    "l3_sec_er": 0.1,
                    "l3_sub_er": 0.05,
                    "l3_res_er": 0.55,
                    "volatility": 0.4,
                },
                "_metadata": {},
            },
        )

    transport = httpx.MockTransport(handler)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    snap = client.get_metrics_with_macro_correlation("NVDA", factors=["bitcoin"])
    assert snap.attrs.get("riskmodels_kind") == "metrics_macro_snapshot"
    assert "l3_market_hr" in snap.columns
    assert snap["macro_corr_bitcoin"].iloc[0] == 0.05


def test_to_llm_context_correlation_dict():
    text = to_llm_context(
        {
            "ticker": "X",
            "return_type": "gross",
            "window_days": 60,
            "method": "spearman",
            "correlations": {"vix": 0.1},
            "overlap_days": 59,
            "warnings": [],
            "_metadata": {},
        },
        include_lineage=False,
    )
    assert "macro_corr_vix" in text or "0.1" in text
    assert "Macro factor correlation" in text


def test_get_factor_correlation_single_mock():
    """Test GET /metrics/{ticker}/correlation with mocked transport."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        return httpx.Response(
            200,
            json={
                "ticker": "AAPL",
                "return_type": "l3_residual",
                "window_days": 126,
                "method": "pearson",
                "correlations": {
                    "vix": 0.42,
                    "bitcoin": 0.15,
                    "gold": -0.08,
                },
                "overlap_days": 126,
                "warnings": [],
                "_metadata": {
                    "model_version": "3.0",
                    "data_as_of": "2026-03-28",
                },
                "_agent": {
                    "latency_ms": 45,
                    "request_id": "req_test_123",
                },
            },
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )

    result = client.get_factor_correlation_single(
        "AAPL",
        factors=["vix", "bitcoin", "gold"],
        window_days=126,
    )

    # Verify request
    assert captured["method"] == "GET"
    assert "/metrics/AAPL/correlation" in captured["url"]
    assert "window_days=126" in captured["url"]
    assert "factors=vix%2Cbitcoin%2Cgold" in captured["url"]  # URL-encoded commas

    # Verify response parsing
    assert result["ticker"] == "AAPL"
    assert result["window_days"] == 126
    assert result["correlations"]["vix"] == 0.42
    assert result["correlations"]["bitcoin"] == 0.15
    assert result["overlap_days"] == 126


def test_get_factor_correlation_single_default_params():
    """Test GET helper uses correct defaults."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "ticker": "NVDA",
                "return_type": "l3_residual",
                "window_days": 252,
                "method": "pearson",
                "correlations": {"vix": 0.35},
                "overlap_days": 252,
                "warnings": [],
                "_metadata": {},
                "_agent": {},
            },
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )

    # Call with defaults only
    result = client.get_factor_correlation_single("NVDA")

    # Verify defaults in URL
    assert "return_type=l3_residual" in captured["url"]
    assert "window_days=252" in captured["url"]
    assert "method=pearson" in captured["url"]
    assert "factors=" not in captured["url"]  # Not included when None

    assert result["ticker"] == "NVDA"


def test_get_factor_correlation_single_ticker_alias():
    """Test that ticker aliases are resolved (e.g., GOOGL -> GOOG)."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "ticker": "GOOG",
                "return_type": "l3_residual",
                "window_days": 252,
                "method": "pearson",
                "correlations": {},
                "overlap_days": 0,
                "warnings": ["Insufficient data"],
                "_metadata": {},
                "_agent": {},
            },
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )

    result = client.get_factor_correlation_single("GOOGL")

    # GOOGL should resolve to GOOG in the URL
    assert "/metrics/GOOG/correlation" in captured["url"]
    assert result["ticker"] == "GOOG"
