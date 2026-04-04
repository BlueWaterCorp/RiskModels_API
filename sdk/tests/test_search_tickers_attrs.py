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


def test_search_tickers_single_ticker_dict_from_search_param():
    """GET /tickers?search=AAPL returns { ticker: 'AAPL' } on exact match."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ticker": "AAPL"})

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )
    df = client.search_tickers(search="AAPL")
    assert not df.empty
    assert "ticker" in df.columns
    assert df["ticker"].astype(str).str.upper().eq("AAPL").any()


def test_search_tickers_string_list_uses_ticker_column():
    """Fast mag7 path returns { tickers: ["AAPL", ...] } — not rows of dicts."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"tickers": ["AAPL", "MSFT"]})

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )
    df = client.search_tickers(mag7=True)
    assert list(df.columns) == ["ticker"]
    assert df["ticker"].tolist() == ["AAPL", "MSFT"]
