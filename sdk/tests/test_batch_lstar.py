"""SDK tests for POST /batch/lstar."""

from __future__ import annotations

from io import BytesIO

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.parsing import lstar_json_to_dataframe


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_batch_lstar_json():
    payload = {
        "results": {
            "NVDA": {
                "ticker": "NVDA",
                "status": "success",
                "dates": ["2026-05-01"],
                "lstar": ["L3"],
                "market_hr": [-0.9],
                "sector_hr": [0.1],
                "subsector_hr": [0.05],
                "total_er": [0.6],
                "residual_return": [0.01],
                "l2_sector_er": [0.2],
                "l3_subsector_er": [0.15],
                "threshold_used": 0.01,
                "market_factor_etf": "SPY",
                "universe": "US_EQUITY",
                "data_source": "zarr",
            }
        },
        "summary": {"total": 1, "success": 1, "errors": 0, "not_found": 0},
        "years": 1,
        "threshold_used": 0.01,
        "market_factor_etf": "SPY",
        "_metadata": {"model_version": "test"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert "/batch/lstar" in str(request.url)
        body = request.content.decode()
        assert '"NVDA"' in body
        return httpx.Response(200, json=payload)

    client = _client(handler)
    out = client.batch_lstar(["NVDA"], threshold=0.01)
    assert isinstance(out, dict)
    assert out["results"]["NVDA"]["status"] == "success"

    dfs = client.batch_lstar_to_dataframes(out)
    assert "NVDA" in dfs
    assert list(dfs["NVDA"].columns) == list(lstar_json_to_dataframe(payload["results"]["NVDA"]).columns)


def test_batch_lstar_parquet():
    df = pd.DataFrame(
        [
            {
                "ticker": "AAPL",
                "date": "2026-05-01",
                "lstar": "L2",
                "residual_return": -0.01,
            }
        ]
    )
    buf = BytesIO()
    pq.write_table(pa.Table.from_pandas(df), buf)
    parquet_bytes = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/batch/lstar" in str(request.url)
        return httpx.Response(
            200,
            content=parquet_bytes,
            headers={"content-type": "application/vnd.apache.parquet"},
        )

    client = _client(handler)
    out, lineage = client.batch_lstar(["AAPL"], format="parquet")
    assert isinstance(out, pd.DataFrame)
    assert "residual_return" in out.columns
    assert lineage is not None
