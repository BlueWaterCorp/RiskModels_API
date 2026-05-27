import json

import httpx

from riskmodels.client import RiskModelsClient


def test_get_metrics_resolves_googl():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "symbol": "GOOG",
                "ticker": "GOOG",
                "teo": "2026-01-01",
                "periodicity": "daily",
                "metrics": {
                    "l3_mkt_hr": 0.5,
                    "l3_mkt_er": 0.25,
                    "l3_sec_er": 0.25,
                    "l3_sub_er": 0.25,
                    "l3_res_er": 0.25,
                },
                "display": {},
                "meta": {},
            },
            headers={"X-Risk-Model-Version": "ERM3-test"},
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=http_client,
    )
    row = client.get_metrics("GOOGL", validate="off")
    assert row["ticker"] == "GOOG"
    assert "GOOG" in captured["url"]


def test_post_portfolio_risk_index_empty_returns_syncing():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        return httpx.Response(
            200,
            json={
                "status": "syncing",
                "message": "No holdings loaded yet.",
                "_metadata": {},
                "_agent": {},
            },
        )

    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    out = client.post_portfolio_risk_index([])
    assert out.get("status") == "syncing"
    assert "/portfolio/risk-index" in captured["url"]
    assert "positions" in captured["body"] and "[]" in captured["body"]


def test_post_portfolio_risk_snapshot_pdf():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        raw = request.content.decode()
        captured["body"] = raw
        if request.url.path.endswith("/portfolio/risk-snapshot"):
            payload = json.loads(raw)
            assert payload.get("format") == "pdf"
            return httpx.Response(
                200,
                content=b"%PDF-1.4 fake pdf bytes for test",
                headers={"Content-Type": "application/pdf"},
            )
        return httpx.Response(404, json={"error": "not found"})

    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    out_pdf, _lineage = client.post_portfolio_risk_snapshot_pdf(
        [("NVDA", 0.5), ("AAPL", 0.5)],
        title="Demo",
    )
    assert isinstance(out_pdf, bytes)
    assert out_pdf.startswith(b"%PDF")
    assert "/portfolio/risk-snapshot" in captured["url"]
    assert json.loads(captured["body"]).get("title") == "Demo"


def test_get_plaid_holdings_calls_endpoint():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "holdings": [],
                "accounts": [],
                "securities": [],
                "connections_count": 0,
                "summary": {"total_value": 0, "account_count": 0, "position_count": 0},
            },
        )

    transport = httpx.MockTransport(handler)
    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=transport),
    )
    out = client.get_plaid_holdings()
    assert "/plaid/holdings" in captured["url"]
    assert out["connections_count"] == 0


def test_get_lstar_returns_dataframe_with_residual_return():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "ticker": "NVDA",
                "dates": ["2026-01-02", "2026-01-03"],
                "lstar": ["L3", "L2"],
                "market_hr": [0.9, 0.8],
                "sector_hr": [0.1, 0.2],
                "subsector_hr": [0.05, None],
                "total_er": [0.7, 0.5],
                "residual_return": [0.012, 0.008],
                "l2_sector_er": [0.02, 0.015],
                "l3_subsector_er": [0.03, 0.01],
                "threshold_used": 0.01,
                "market_factor_etf": "SPY",
                "universe": "US_EQUITY",
                "data_source": "zarr",
            },
            headers={"X-Risk-Model-Version": "ERM3-test"},
        )

    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    df = client.get_lstar("NVDA", years=2, threshold=0.01)
    assert "/lstar" in captured["url"]
    assert "ticker=NVDA" in captured["url"]
    assert list(df.columns) == [
        "date",
        "lstar",
        "market_hr",
        "sector_hr",
        "subsector_hr",
        "total_er",
        "residual_return",
        "l2_sector_er",
        "l3_subsector_er",
    ]
    assert len(df) == 2
    assert df.iloc[0]["residual_return"] == 0.012


def test_get_returns_decomposition_returns_semantic_columns():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "ticker": "AAPL",
                "dates": ["2026-01-02"],
                "gross_return": [0.01],
                "l1_factor_return": [0.008],
                "l2_factor_return": [0.002],
                "l3_factor_return": [0.001],
                "l1_combined_factor_return": [0.008],
                "l2_combined_factor_return": [0.01],
                "l3_combined_factor_return": [0.011],
                "l1_residual_return": [0.002],
                "l2_residual_return": [0.0015],
                "l3_residual_return": [0.001],
                "market_factor_etf": "SPY",
                "universe": "SPY_uni_mc_3000",
                "data_source": "zarr",
            },
            headers={"X-Risk-Model-Version": "ERM3-test"},
        )

    client = RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    df = client.get_returns_decomposition("AAPL", years=1)
    assert "/returns-decomposition" in captured["url"]
    assert "ticker=AAPL" in captured["url"]
    assert list(df.columns) == [
        "date",
        "gross_return",
        "l1_factor_return",
        "l2_factor_return",
        "l3_factor_return",
        "l1_combined_factor_return",
        "l2_combined_factor_return",
        "l3_combined_factor_return",
        "l1_residual_return",
        "l2_residual_return",
        "l3_residual_return",
    ]
    assert df.iloc[0]["gross_return"] == 0.01
