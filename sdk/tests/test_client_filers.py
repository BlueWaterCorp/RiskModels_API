"""13F filer methods on RiskModelsClient (D.8.9; D.8.39 bi-temporal params).

Mocked-HTTP coverage for the six filer methods: URL/param construction,
as_of pass-through, as_of_basis / report_date / filing_date surfacing,
and 404 handling (as_of-specific message preserved on APIError).
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.exceptions import APIError

FILER_ID = "BW-FILER-CIK0001067983"


def _client(handler) -> RiskModelsClient:
    return RiskModelsClient(
        base_url="https://riskmodels.app/api",
        api_key="test",
        validate="off",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_search_filers_builds_params():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"results": [{"bw_filer_id": FILER_ID}]})

    out = _client(handler).search_filers(
        "Berkshire", filer_type="hedge_fund", modelable_only=True, limit=10
    )
    assert out["results"][0]["bw_filer_id"] == FILER_ID
    assert "/13f/filers/search" in captured["url"]
    assert "q=Berkshire" in captured["url"]
    assert "filer_type=hedge_fund" in captured["url"]
    assert "modelable_only=true" in captured["url"]
    assert "limit=10" in captured["url"]


def test_search_filers_clamps_limit_to_500():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"results": []})

    _client(handler).search_filers("gold", limit=9999)
    assert "limit=500" in captured["url"]


def test_get_filer_surfaces_bitemporal_body_fields():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "bw_filer_id": FILER_ID,
                "name": "BERKSHIRE HATHAWAY INC",
                "latest": {
                    "report_date": "2026-03-31",
                    "filing_date": "2026-05-15",
                    "extracted_at": "2026-06-02T04:00:00Z",
                },
            },
            headers={
                "X-Data-As-Of": "2026-03-31",
                "X-Data-Filing-Date": "2026-05-15",
            },
        )

    out = _client(handler).get_filer(FILER_ID)
    assert f"/13f/filers/{FILER_ID}" in captured["url"]
    assert out["latest"]["report_date"] == "2026-03-31"
    assert out["latest"]["filing_date"] == "2026-05-15"
    assert out["latest"]["extracted_at"] == "2026-06-02T04:00:00Z"


def test_get_filer_holdings_passes_as_of_and_surfaces_basis():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "bw_filer_id": FILER_ID,
                "as_of": "2026-04-30",
                "teo": "2025-12-31",
                "report_date": "2025-12-31",
                "filing_date": "2026-02-17",
                "as_of_basis": "filing_date",
                "holdings": [
                    {"security_id": "BW-US-APPLE", "adj_mv": 1.0, "weight": 0.5}
                ],
            },
        )

    out = _client(handler).get_filer_holdings(FILER_ID, limit=5, as_of="2026-04-30")
    assert f"/13f/filers/{FILER_ID}/holdings" in captured["url"]
    assert captured["params"] == {"limit": "5", "as_of": "2026-04-30"}
    # Knowledge mode: Q4 filed 2026-02-17 is the latest quarter KNOWN by
    # 2026-04-30 (Q1's 13F lands ~mid-May), and the basis says so.
    assert out["report_date"] == "2025-12-31"
    assert out["filing_date"] == "2026-02-17"
    assert out["as_of_basis"] == "filing_date"


def test_get_filer_holdings_omits_params_when_defaults():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json={"holdings": []})

    _client(handler).get_filer_holdings(FILER_ID)
    assert captured["params"] == {}


def test_get_filer_holdings_404_preserves_as_of_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={
                "error": "No holdings were known for this filer as of the requested date",
                "bw_filer_id": FILER_ID,
                "as_of": "2010-01-01",
            },
        )

    with pytest.raises(APIError) as excinfo:
        _client(handler).get_filer_holdings(FILER_ID, as_of="2010-01-01")
    assert excinfo.value.status_code == 404
    assert "known for this filer as of the requested date" in str(excinfo.value)
    assert excinfo.value.body["as_of"] == "2010-01-01"


def test_get_filer_portfolio_passes_window_and_as_of_and_echoes_basis():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "bw_filer_id": FILER_ID,
                "as_of": "2026-01-31",
                "as_of_basis": "filing_date",
                "n_periods": 2,
                "start_teo": "2025-06-30",
                "end_teo": "2025-09-30",
                "rows": [
                    {"teo": "2025-06-30", "filing_date": "2025-08-14"},
                    {"teo": "2025-09-30", "filing_date": "2025-11-14"},
                ],
            },
        )

    out = _client(handler).get_filer_portfolio(
        FILER_ID,
        start_date="2025-01-01",
        end_date="2025-12-31",
        as_of="2026-01-31",
    )
    assert f"/13f/filers/{FILER_ID}/portfolio" in captured["url"]
    assert captured["params"] == {
        "start_date": "2025-01-01",
        "end_date": "2025-12-31",
        "as_of": "2026-01-31",
    }
    assert out["as_of_basis"] == "filing_date"
    # Per-quarter knowledge-time stamps ride on each row (D.8.39).
    assert [r["filing_date"] for r in out["rows"]] == ["2025-08-14", "2025-11-14"]


def test_get_filer_portfolio_report_date_fallback_is_labeled():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "bw_filer_id": FILER_ID,
                "as_of": "2026-01-31",
                "as_of_basis": "report_date",
                "n_periods": 1,
                "rows": [{"teo": "2025-12-31", "filing_date": None}],
            },
        )

    out = _client(handler).get_filer_portfolio(FILER_ID, as_of="2026-01-31")
    # Pre-1.4-schema zarr: no per-quarter filing dates, so the server
    # selected on report_date and SAID so — never a silent fallback.
    assert out["as_of_basis"] == "report_date"
    assert out["rows"][0]["filing_date"] is None


def test_get_filer_portfolio_404_preserves_as_of_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={
                "error": "No portfolio history was known for this filer as of the requested date",
                "bw_filer_id": FILER_ID,
                "as_of": "2000-01-01",
            },
        )

    with pytest.raises(APIError) as excinfo:
        _client(handler).get_filer_portfolio(FILER_ID, as_of="2000-01-01")
    assert excinfo.value.status_code == 404
    assert "was known for this filer as of the requested date" in str(excinfo.value)


def test_get_filer_concentration_builds_url_and_window():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "bw_filer_id": FILER_ID,
                "start_teo": "2024-03-31",
                "end_teo": "2026-03-31",
                "latest_effective_n": 12.4,
                "median_effective_n": 11.9,
                "latest_top10_weight_sum": 0.91,
            },
        )

    out = _client(handler).get_filer_concentration(
        FILER_ID, start_date="2024-01-01", end_date="2026-06-30"
    )
    assert f"/13f/filers/{FILER_ID}/concentration" in captured["url"]
    assert captured["params"] == {
        "start_date": "2024-01-01",
        "end_date": "2026-06-30",
    }
    assert out["latest_effective_n"] == 12.4


def test_get_filer_concentration_404_raises_api_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Filer not found"})

    with pytest.raises(APIError) as excinfo:
        _client(handler).get_filer_concentration("BW-FILER-CIK0000000000")
    assert excinfo.value.status_code == 404


def test_get_filer_snapshot_pdf_returns_bytes_and_writes_path(tmp_path: Path):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["accept"] = request.headers.get("Accept")
        return httpx.Response(
            200,
            content=b"%PDF-1.4 fake filer tearsheet",
            headers={"Content-Type": "application/pdf"},
        )

    out_file = tmp_path / "filer_f1.pdf"
    pdf = _client(handler).get_filer_snapshot_pdf(FILER_ID, path=out_file)
    assert f"/13f/filers/{FILER_ID}/snapshot.pdf" in captured["url"]
    assert captured["accept"] == "application/pdf"
    assert isinstance(pdf, bytes) and pdf.startswith(b"%PDF")
    assert out_file.read_bytes() == pdf


def test_get_filer_snapshot_pdf_without_path_only_returns_bytes(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"%PDF-1.4 fake filer tearsheet",
            headers={"Content-Type": "application/pdf"},
        )

    pdf = _client(handler).get_filer_snapshot_pdf(FILER_ID)
    assert isinstance(pdf, bytes) and pdf.startswith(b"%PDF")
    assert list(tmp_path.iterdir()) == []
