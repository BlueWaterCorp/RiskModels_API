import httpx

from riskmodels.client import RiskModelsClient
from riskmodels.legends import SHORT_ERM3_LEGEND


def test_search_tickers_dataframe_has_legend():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"ticker": "AAPL", "name": "Apple"}])

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )
    df = client.search_tickers(search="AAPL")
    assert df.attrs.get("legend") == SHORT_ERM3_LEGEND
    assert "riskmodels_semantic_cheatsheet" in df.attrs
    assert df.attrs.get("riskmodels_kind") == "tickers_universe"
