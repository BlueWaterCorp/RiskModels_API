import httpx

from riskmodels.client import RiskModelsClient


def test_get_metrics_resolves_googl():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "symbol": "GOOG",
                "ticker": "GOOG",
                "teo": "2026-01-01",
                "periodicity": "daily",
                "metrics": {
                    "l3_mkt_hr": 0.5,
                    "l3_mkt_er": 0.25,
                    "l3_sec_er": 0.25,
                    "l3_sub_er": 0.25,
                    "l3_res_er": 0.25,
                },
                "display": {},
                "meta": {},
            },
            headers={"X-Risk-Model-Version": "ERM3-test"},
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )
    row = client.get_metrics("GOOGL", validate="off")
    assert row["ticker"] == "GOOG"
    assert "GOOG" in captured["url"]


def test_post_portfolio_risk_index_empty_returns_syncing():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        return httpx.Response(
            200,
            json={
                "status": "syncing",
                "message": "No holdings loaded yet.",
                "_metadata": {},
                "_agent": {},
            },
        )

    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    out = client.post_portfolio_risk_index([])
    assert out.get("status") == "syncing"
    assert "/portfolio/risk-index" in captured["url"]
    assert "positions" in captured["body"] and "[]" in captured["body"]


def test_get_plaid_holdings_calls_endpoint():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "holdings": [],
                "accounts": [],
                "securities": [],
                "connections_count": 0,
                "summary": {"total_value": 0, "account_count": 0, "position_count": 0},
            },
        )

    transport = httpx.MockTransport(handler)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    out = client.get_plaid_holdings()
    assert "/plaid/holdings" in captured["url"]
    assert out["connections_count"] == 0
