"""Point-in-time fund holdings parameters on the Python client."""

from __future__ import annotations

import pytest
import httpx

from riskmodels.client import RiskModelsClient

FUND_ID = "BW-FUND-S000006037"


def _client(handler) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_get_fund_holdings_passes_point_in_time_params() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "bw_fund_id": FUND_ID,
                "report_date": "2020-03-31",
                "filing_date": "2020-05-26",
                "time_basis": "available_date",
                "net_assets": 98_400_000_000,
            },
        )

    out = _client(handler).get_fund_holdings(
        FUND_ID,
        limit=15,
        as_of="2020-06-30",
        time_basis="available_date",
    )

    assert captured["params"] == {
        "limit": "15",
        "as_of": "2020-06-30",
        "time_basis": "available_date",
    }
    assert out["report_date"] == "2020-03-31"
    assert out["filing_date"] == "2020-05-26"


def test_get_fund_holdings_omits_optional_params() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json={"bw_fund_id": FUND_ID})

    _client(handler).get_fund_holdings(FUND_ID)
    assert captured["params"] == {}


def test_get_fund_holdings_requires_time_basis_with_as_of() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("no request should be sent")

    with pytest.raises(ValueError, match="time_basis is required"):
        _client(handler).get_fund_holdings(FUND_ID, as_of="2020-06-30")
