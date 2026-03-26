"""get_dataset → xarray (§2C; optional xarray extra)."""

from __future__ import annotations

import json
from io import BytesIO

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from riskmodels.client import RiskModelsClient


def test_get_dataset_returns_dataset_with_sdk_attrs():
    pytest.importorskip("xarray")
    long_df = pd.DataFrame(
        [
            {
                "ticker": "AAPL",
                "date": "2026-01-01",
                "gross_return": 0.01,
                "l1": 0.5,
                "l2": 0.1,
                "l3": -0.02,
            }
        ]
    )
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(long_df), buf)
    blob = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and "/batch/analyze" in str(request.url):
            payload = json.loads(request.content.decode())
            if payload.get("format") == "parquet" and payload.get("metrics") == ["returns"]:
                return httpx.Response(200, content=blob, headers={"Content-Type": "application/octet-stream"})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    ds = client.get_dataset(["AAPL"], years=1, format="parquet")
    assert set(ds.dims) >= {"ticker", "date"}
    assert ds.attrs.get("riskmodels_kind") == "batch_returns_xarray"
