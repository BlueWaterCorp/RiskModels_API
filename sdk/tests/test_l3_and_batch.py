"""get_l3_decomposition and batch_analyze (Phase 1 / §2A)."""

from __future__ import annotations

import json
from io import BytesIO

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from riskmodels.client import RiskModelsClient
from riskmodels.mapping import BATCH_RETURNS_LONG_RENAME


def _client(handler):
    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_get_l3_decomposition_parses_and_metadata():
    body = {
        "dates": ["2026-01-01", "2026-01-02"],
        "l3_market_hr": [0.1, 0.2],
        "l3_sector_hr": [0.1, 0.1],
        "l3_subsector_hr": [0.0, -0.05],
        "l3_market_er": [0.25, 0.25],
        "l3_sector_er": [0.25, 0.25],
        "l3_subsector_er": [0.25, 0.25],
        "l3_residual_er": [0.25, 0.25],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/l3-decomposition" in str(request.url)
        return httpx.Response(200, json=body)

    client = _client(handler)
    df = client.get_l3_decomposition("AAPL", validate="off")
    assert len(df) == 2
    assert "l3_market_hr" in df.columns
    assert df.attrs.get("riskmodels_kind") == "l3_decomposition"


def test_get_l3_decomposition_forwards_years_kwarg():
    """years=N should reach the request URL as a query param."""
    body = {
        "dates": ["2020-01-02"],
        "l3_market_hr": [0.1],
        "l3_sector_hr": [0.1],
        "l3_subsector_hr": [0.0],
        "l3_market_er": [0.25],
        "l3_sector_er": [0.25],
        "l3_subsector_er": [0.25],
        "l3_residual_er": [0.25],
    }

    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, json=body)

    client = _client(handler)

    # Default call — no years param in URL.
    client.get_l3_decomposition("AAPL", validate="off")
    assert "years=" not in seen_urls[-1]

    # Explicit years=5 — must appear in the URL.
    client.get_l3_decomposition("AAPL", years=5, validate="off")
    assert "years=5" in seen_urls[-1]

    # Combined with market_factor_etf — both params present.
    client.get_l3_decomposition("AAPL", years=10, market_factor_etf="SPY", validate="off")
    url = seen_urls[-1]
    assert "years=10" in url
    assert "market_factor_etf=SPY" in url


def test_batch_analyze_parquet_long_normalizes_columns():
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
            if payload.get("format") == "parquet":
                return httpx.Response(200, content=blob, headers={"Content-Type": "application/octet-stream"})
        return httpx.Response(404)

    client = _client(handler)
    out = client.batch_analyze(["AAPL"], ["returns"], years=1, format="parquet")
    assert isinstance(out, tuple)
    df, _lin = out
    assert BATCH_RETURNS_LONG_RENAME["l1"] in df.columns
    assert "l3_market_hr" in df.columns
    assert df.attrs.get("riskmodels_kind") == "batch_returns_long"
