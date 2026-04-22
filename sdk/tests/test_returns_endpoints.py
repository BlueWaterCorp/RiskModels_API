"""Deprecated get_returns / get_etf_returns wrappers route to /ticker-returns.

Both wrappers emit DeprecationWarning and forward to get_ticker_returns, which
accepts both stocks and ETFs. The underlying /returns and /etf-returns routes
no longer exist; the SDK aliases keep older notebooks working.
"""

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


def test_get_returns_forwards_to_ticker_returns_json():
    payload = {
        "ticker": "AAPL",
        "asset_type": "stock",
        "data": [{"date": "2026-01-01", "returns_gross": 0.01, "price_close": 180.0}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/ticker-returns" in str(request.url)
        assert _query_format(request) == "json"
        return httpx.Response(200, json=payload)

    client = _client(handler)
    with pytest.warns(DeprecationWarning, match="get_ticker_returns"):
        out = client.get_returns("AAPL", format="json")
    assert isinstance(out, pd.DataFrame)
    assert "returns_gross" in out.columns


def test_get_returns_forwards_to_ticker_returns_parquet():
    df = pd.DataFrame(
        [{"date": "2026-01-01", "returns_gross": 0.01, "price_close": 180.0}]
    )
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(df), buf)
    blob = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/ticker-returns" in str(request.url)
        assert _query_format(request) == "parquet"
        return httpx.Response(
            200, content=blob, headers={"Content-Type": "application/octet-stream"}
        )

    client = _client(handler)
    with pytest.warns(DeprecationWarning):
        out = client.get_returns("AAPL", format="parquet")
    assert isinstance(out, pd.DataFrame)
    assert out.attrs.get("riskmodels_kind") == "ticker_returns"


def test_get_etf_returns_forwards_to_ticker_returns_json():
    # ETF payload: only date / returns_gross / price_close are emitted — the
    # L1/L2/L3 fields are omitted entirely, not returned as null, since ETFs
    # are not factor-decomposed.
    payload = {
        "ticker": "SPY",
        "asset_type": "etf",
        "data": [
            {"date": "2026-01-01", "returns_gross": 0.001, "price_close": 500.0},
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/ticker-returns" in str(request.url)
        return httpx.Response(200, json=payload)

    client = _client(handler)
    with pytest.warns(DeprecationWarning, match="get_ticker_returns"):
        out = client.get_etf_returns("SPY", format="json")
    assert isinstance(out, pd.DataFrame)
    assert out.iloc[0]["returns_gross"] == pytest.approx(0.001)
    # asset_type flows through as a DataFrame attr so downstream code can branch
    assert out.attrs.get("asset_type") == "etf"
    # L* columns should be absent from the ETF frame — not present-but-null
    for col in (
        "l1_cfr",
        "l2_cfr",
        "l3_cfr",
        "l3_mkt_hr",
        "l3_sec_hr",
        "l3_sub_hr",
        "l3_mkt_er",
        "l3_sec_er",
        "l3_sub_er",
        "l3_res_er",
    ):
        assert col not in out.columns, f"ETF frame should not carry {col}"


def test_get_etf_returns_forwards_to_ticker_returns_csv():
    df = pd.DataFrame(
        [{"date": "2026-01-01", "returns_gross": 0.001, "price_close": 500.0}]
    )
    blob = df.to_csv(index=False).encode("utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/ticker-returns" in str(request.url)
        assert _query_format(request) == "csv"
        return httpx.Response(200, content=blob, headers={"Content-Type": "text/csv"})

    client = _client(handler)
    with pytest.warns(DeprecationWarning):
        out = client.get_etf_returns("SPY", format="csv")
    assert isinstance(out, pd.DataFrame)
    assert out.attrs.get("riskmodels_kind") == "ticker_returns"


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
