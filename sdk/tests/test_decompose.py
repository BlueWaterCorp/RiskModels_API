"""Tests for RiskModelsClient.decompose()."""

from __future__ import annotations

import httpx
import pytest

from riskmodels.client import RiskModelsClient


DECOMPOSE_RESPONSE = {
    "ticker": "NVDA",
    "symbol": "NVDA",
    "data_as_of": "2026-04-21",
    "teo": "2026-04-21",
    "exposure": {
        "market":    {"er": 0.45, "hr": 1.10, "hedge_etf": "SPY"},
        "sector":    {"er": 0.22, "hr": 0.35, "hedge_etf": "XLK"},
        "subsector": {"er": 0.20, "hr": 0.60, "hedge_etf": "SMH"},
        "residual":  {"er": 0.13, "hr": None, "hedge_etf": None},
    },
    "hedge": {"SPY": -1.10, "XLK": -0.35, "SMH": -0.60},
    "_metadata": {},
}


def _mock_client(response_json: dict, captured: dict) -> RiskModelsClient:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode() if request.content else ""
        return httpx.Response(200, json=response_json)

    transport = httpx.MockTransport(handler)
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )


def test_decompose_posts_ticker_body():
    captured: dict = {}
    client = _mock_client(DECOMPOSE_RESPONSE, captured)
    body = client.decompose("nvda")
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/decompose")
    assert '"ticker"' in captured["body"]
    assert body["ticker"] == "NVDA"
    assert body["exposure"]["market"]["hedge_etf"] == "SPY"


def test_decompose_as_dataframe_returns_four_rows_with_attrs():
    pd = pytest.importorskip("pandas")
    captured: dict = {}
    client = _mock_client(DECOMPOSE_RESPONSE, captured)
    df = client.decompose("NVDA", as_dataframe=True)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 4
    assert list(df["layer"]) == ["market", "sector", "subsector", "residual"]
    assert df.loc[df["layer"] == "residual", "hr"].iloc[0] is None or (
        df.loc[df["layer"] == "residual", "hr"].isna().iloc[0]
    )
    assert "riskmodels_lineage" in df.attrs
    assert df.attrs.get("riskmodels_kind") == "decompose_position"


def test_decompose_hedge_map_matches_sign_convention():
    """hedge[etf] must equal -exposure[layer].hr for each tradable layer."""
    captured: dict = {}
    client = _mock_client(DECOMPOSE_RESPONSE, captured)
    body = client.decompose("NVDA")
    for name in ("market", "sector", "subsector"):
        etf = body["exposure"][name]["hedge_etf"]
        hr = body["exposure"][name]["hr"]
        assert body["hedge"][etf] == pytest.approx(-hr)
