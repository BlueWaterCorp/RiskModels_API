"""get_returns and get_etf_returns (§2B)."""

from __future__ import annotations

from io import BytesIO
from urllib.parse import parse_qs, urlparse

import httpx
import pandas as pd
import pytest
import pyarrow as pa
import pyarrow.parquet as pq

from riskmodels.client import RiskModelsClient


def _query_format(request: httpx.Request) -> str:
    q = parse_qs(urlparse(str(request.url)).query)
    return (q.get("format") or ["json"])[0]


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_get_returns_json():
    payload = {"ticker": "AAPL", "dates": ["2026-01-01"], "values": [0.01]}

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/returns" in str(request.url)
        assert _query_format(request) == "json"
        return httpx.Response(200, json=payload)

    client = _client(handler)
    out = client.get_returns("AAPL", format="json")
    assert out["ticker"] == "AAPL"


def test_get_returns_parquet_dataframe():
    df = pd.DataFrame([{"ticker": "AAPL", "date": "2026-01-01", "close": 100.0}])
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(df), buf)
    blob = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/returns" in str(request.url)
        assert _query_format(request) == "parquet"
        return httpx.Response(200, content=blob, headers={"Content-Type": "application/octet-stream"})

    client = _client(handler)
    out = client.get_returns("AAPL", format="parquet")
    assert isinstance(out, pd.DataFrame)
    assert out.attrs.get("riskmodels_kind") == "returns"


def test_get_etf_returns_json():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "/etf-returns" in str(request.url)
        return httpx.Response(200, json={"ticker": "SPY", "rows": []})

    client = _client(handler)
    out = client.get_etf_returns("SPY", format="json")
    assert out["ticker"] == "SPY"


def test_get_etf_returns_csv_dataframe():
    df = pd.DataFrame([{"ticker": "SPY", "date": "2026-01-01", "ret": 0.001}])
    blob = df.to_csv(index=False).encode("utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/etf-returns" in str(request.url)
        assert _query_format(request) == "csv"
        return httpx.Response(200, content=blob, headers={"Content-Type": "text/csv"})

    client = _client(handler)
    out = client.get_etf_returns("SPY", format="csv")
    assert isinstance(out, pd.DataFrame)
    assert out.attrs.get("riskmodels_kind") == "etf_returns"


def test_get_dataset_json_format_raises_before_http():
    transport = httpx.MockTransport(lambda r: httpx.Response(500))
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    with pytest.raises(ValueError, match="parquet"):
        client.get_dataset(["AAPL"], format="json")
