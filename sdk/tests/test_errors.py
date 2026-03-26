"""HTTP error mapping and transport edge cases (Phase 2.2)."""

from __future__ import annotations

import httpx
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.exceptions import APIError, AuthError


def _client(http_client: httpx.Client) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )


def test_401_raises_auth_error_with_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Invalid or expired token"})

    transport = httpx.MockTransport(handler)
    client = _client(httpx.Client(transport=transport))
    with pytest.raises(AuthError) as exc_info:
        client.get_metrics("AAPL", validate="off")
    err = exc_info.value
    assert err.status_code == 401
    assert isinstance(err, APIError)


def test_402_raises_api_error_with_billing_context():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "message": "Payment required",
                "error": "insufficient_balance",
                "detail": "Add billing or upgrade plan",
            },
        )

    transport = httpx.MockTransport(handler)
    client = _client(httpx.Client(transport=transport))
    with pytest.raises(APIError) as exc_info:
        client.get_metrics("AAPL", validate="off")
    err = exc_info.value
    assert err.status_code == 402
    msg = str(err).lower()
    assert "balance" in msg or "billing" in msg or "payment" in msg


def test_429_raises_api_error_rate_limit():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"message": "Rate limit exceeded. Retry after 60s"})

    transport = httpx.MockTransport(handler)
    client = _client(httpx.Client(transport=transport))
    with pytest.raises(APIError) as exc_info:
        client.get_metrics("AAPL", validate="off")
    err = exc_info.value
    assert err.status_code == 429
    assert "rate" in str(err).lower()


def test_read_timeout_propagates():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out reading response")

    transport = httpx.MockTransport(handler)
    client = _client(httpx.Client(transport=transport))
    with pytest.raises(httpx.ReadTimeout):
        client.get_metrics("AAPL", validate="off")


def test_non_json_error_body_surfaces_clean_message():
    """4xx with non-JSON body: transport falls back to r.text (no JSONDecodeError leak)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            content=b"<html>bad gateway</html>",
            headers={"Content-Type": "text/html"},
        )

    transport = httpx.MockTransport(handler)
    client = _client(httpx.Client(transport=transport))
    with pytest.raises(APIError) as exc_info:
        client.get_metrics("AAPL", validate="off")
    err = exc_info.value
    assert err.status_code == 400
    assert isinstance(err.body, str)
    assert "html" in str(err).lower() or "bad" in str(err).lower()
