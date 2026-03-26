"""RiskModelsClient.discover (§2B)."""

from __future__ import annotations

import httpx

from riskmodels.client import RiskModelsClient


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_discover_json_to_stdout_false_returns_spec_dict():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("discover should not HTTP without live=True")

    client = _client(handler)
    out = client.discover(format="json", to_stdout=False)
    assert isinstance(out, dict)
    assert "sdk_version" in out
    assert "methods" in out


def test_discover_markdown_to_stdout_false_contains_methods():
    client = _client(lambda r: httpx.Response(500))
    text = client.discover(format="markdown", to_stdout=False)
    assert "get_metrics" in text or "get_risk" in text


def test_discover_live_true_pings_tickers():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and "/tickers" in str(request.url):
            return httpx.Response(
                200,
                json=[{"ticker": "AAPL", "name": "Apple"}],
                headers={"X-Risk-Model-Version": "ERM3-live"},
            )
        return httpx.Response(404)

    client = _client(handler)
    out = client.discover(format="json", to_stdout=False, live=True)
    assert out.get("live_tickers_ping", {}).get("ok") is True
    assert "lineage" in out["live_tickers_ping"]
