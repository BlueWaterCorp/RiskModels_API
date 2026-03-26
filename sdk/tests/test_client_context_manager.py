"""Context manager closes HTTP client (§2C)."""

from __future__ import annotations

import httpx

from riskmodels.client import RiskModelsClient


def test_context_manager_closes_underlying_httpx_client():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": "AAPL", "metrics": {}})

    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    assert not http.is_closed
    with RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http,
    ):
        pass
    assert http.is_closed
