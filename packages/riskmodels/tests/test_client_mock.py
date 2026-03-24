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
