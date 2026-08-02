"""Unit tests for RiskModelsClient.get_peers (HTTPS only)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pandas as pd

from riskmodels.client import RiskModelsClient
from riskmodels.lineage import RiskLineage


def _client_with_peers_body(body: dict[str, Any]) -> RiskModelsClient:
    c = RiskModelsClient(base_url="https://example.test/api", api_key="rm_test")
    lin = RiskLineage()
    c._transport = MagicMock()
    c._transport.request.return_value = (body, lin, None)
    return c


def test_get_peers_dataframe():
    body = {
        "ticker": "NVDA",
        "target": {
            "ticker": "NVDA",
            "company_name": "NVIDIA",
            "market_cap": 1e12,
            "sector_etf": "XLK",
            "subsector_etf": "SOXX",
            "symbol": "BW-X",
        },
        "group_by": "subsector_etf",
        "group_etf": "SOXX",
        "peers": [
            {
                "ticker": "AMD",
                "company_name": "AMD",
                "market_cap": 2e11,
                "sector_etf": "XLK",
                "subsector_etf": "SOXX",
                "symbol": "BW-Y",
            }
        ],
        "peer_count": 1,
        "warnings": [],
    }
    c = _client_with_peers_body(body)
    df = c.get_peers("NVDA", as_dataframe=True)
    assert isinstance(df, pd.DataFrame)
    assert list(df["ticker"]) == ["AMD"]
    assert df.attrs["riskmodels_peers_group_etf"] == "SOXX"
    c._transport.request.assert_called_once()
    args, kwargs = c._transport.request.call_args
    assert args[0] == "GET"
    assert args[1] == "/peers"
    assert kwargs["params"]["ticker"] == "NVDA"


def test_get_peers_raw_dict():
    body = {
        "ticker": "NVDA",
        "target": {"ticker": "NVDA", "symbol": "BW-X"},
        "group_by": "sector_etf",
        "group_etf": "XLK",
        "peers": [],
        "peer_count": 0,
        "warnings": ["thin cohort"],
    }
    c = _client_with_peers_body(body)
    out = c.get_peers("nvda", group_by="sector_etf", limit=10, as_dataframe=False)
    assert out["group_etf"] == "XLK"
    assert out["warnings"] == ["thin cohort"]
