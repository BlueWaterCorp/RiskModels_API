"""get_ticker_returns JSON / Parquet / CSV (Phase 1.1)."""

from __future__ import annotations

import warnings
from io import BytesIO
from urllib.parse import parse_qs, urlparse

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from riskmodels.client import RiskModelsClient
from riskmodels.exceptions import ValidationWarning
from riskmodels.legends import SHORT_ERM3_LEGEND
from riskmodels.mapping import TICKER_RETURNS_COLUMN_RENAME


def _wire_row(**overrides):
    base = {
        "date": "2026-01-02",
        "l3_mkt_hr": 0.11,
        "l3_sec_hr": 0.22,
        "l3_sub_hr": -0.03,
        "l3_mkt_er": 0.25,
        "l3_sec_er": 0.25,
        "l3_sub_er": 0.25,
        "l3_res_er": 0.25,
        "returns_gross": 0.001,
        "price_close": 50.0,
    }
    base.update(overrides)
    return base


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_ticker_returns_json_renames_all_columns_and_attrs():
    rows = [_wire_row()]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/ticker-returns" in str(request.url)
        assert (parse_qs(urlparse(str(request.url)).query).get("format") or ["json"])[0] == "json"
        return httpx.Response(200, json={"data": rows, "_metadata": {}})

    client = _client(handler)
    df = client.get_ticker_returns("AAPL", validate="off")
    assert not df.empty
    for wire, semantic in TICKER_RETURNS_COLUMN_RENAME.items():
        assert semantic in df.columns
        assert wire not in df.columns
    assert df.attrs.get("riskmodels_kind") == "ticker_returns"
    assert df.attrs.get("legend") == SHORT_ERM3_LEGEND


def test_ticker_returns_json_trailing_nulls_warn_and_off():
    rows = [
        _wire_row(),
        {
            "date": "2026-01-03",
            "l3_mkt_hr": None,
            "l3_sec_hr": None,
            "l3_sub_hr": None,
            "l3_mkt_er": None,
            "l3_sec_er": None,
            "l3_sub_er": None,
            "l3_res_er": None,
            "returns_gross": None,
            "price_close": None,
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": rows, "_metadata": {}})

    client = _client(handler)
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        client.get_ticker_returns("AAPL", validate="warn")
    assert any(isinstance(x.message, ValidationWarning) for x in w)

    with warnings.catch_warnings(record=True) as w2:
        warnings.simplefilter("always")
        client.get_ticker_returns("AAPL", validate="off")
    assert not w2


def test_ticker_returns_parquet_wire_columns_renamed():
    wire_df = pd.DataFrame([_wire_row()])
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(wire_df), buf)
    blob = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        fmt = (parse_qs(urlparse(str(request.url)).query).get("format") or ["json"])[0]
        assert fmt == "parquet"
        return httpx.Response(
            200,
            content=blob,
            headers={"Content-Type": "application/vnd.apache.parquet"},
        )

    client = _client(handler)
    df = client.get_ticker_returns("AAPL", format="parquet", validate="off")
    assert "l3_market_hr" in df.columns
    assert "l3_mkt_hr" not in df.columns


def test_ticker_returns_csv_wire_columns_renamed():
    wire_df = pd.DataFrame([_wire_row()])
    blob = wire_df.to_csv(index=False).encode("utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        fmt = (parse_qs(urlparse(str(request.url)).query).get("format") or ["json"])[0]
        assert fmt == "csv"
        return httpx.Response(200, content=blob, headers={"Content-Type": "text/csv"})

    client = _client(handler)
    df = client.get_ticker_returns("AAPL", format="csv", validate="off")
    assert "l3_market_hr" in df.columns
