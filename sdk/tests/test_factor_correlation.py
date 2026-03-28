"""Tests for factor correlation endpoints."""

import httpx
import pytest

from riskmodels import RiskModelsClient


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
