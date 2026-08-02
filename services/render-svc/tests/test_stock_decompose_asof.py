"""G.42 — historical as_of pass-through for stock panels.

`_load_stock_decompose` used to 501 on any as_of that didn't match the
upstream `data_as_of`. With /api/decompose serving "latest row <= as_of"
(reality mode, report_date basis — ADR 2026-08-01), the loader forwards
the date and resolves to the SERVED row's date from the `as_of_resolved`
echo, so the artifact's GCS path and X-Artifact-Resolved-As-Of carry the
date the numbers are actually from.

Kept separate from test_artifacts.py to avoid merge friction with the
peer-artifact work landing there in parallel.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import render_svc.artifacts as artifacts
from render_svc.artifacts import _fetch_decompose, _load_stock_decompose


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class TestLoadStockDecomposeAsOf:
    def _patch_fetch(self, monkeypatch, payload):
        calls: list[tuple[str, str | None]] = []

        def fake(ticker: str, as_of: str | None = None) -> dict:
            calls.append((ticker, as_of))
            return payload

        monkeypatch.setattr(artifacts, "_fetch_decompose", fake)
        return calls

    def test_latest_path_unchanged(self, monkeypatch):
        calls = self._patch_fetch(
            monkeypatch, {"ticker": "NVDA", "data_as_of": "2026-07-31"}
        )
        payload, resolved = _load_stock_decompose("BW-STOCK-NVDA", "latest")
        assert resolved == "2026-07-31"
        assert payload["ticker"] == "NVDA"
        # Latest requests must not send an as_of upstream.
        assert calls == [("NVDA", None)]

    def test_historical_as_of_passes_through_and_resolves_served_row(
        self, monkeypatch
    ):
        calls = self._patch_fetch(
            monkeypatch,
            {
                "ticker": "NVDA",
                "data_as_of": "2026-07-31",
                "teo": "2025-06-27",
                "as_of": "2025-06-30",
                "as_of_resolved": "2025-06-27",
                "as_of_basis": "report_date",
            },
        )
        payload, resolved = _load_stock_decompose("BW-STOCK-NVDA", "2025-06-30")
        # Resolved is the SERVED row (<= requested), not the request date and
        # not the registry-wide data_as_of.
        assert resolved == "2025-06-27"
        assert payload["as_of_basis"] == "report_date"
        assert calls == [("NVDA", "2025-06-30")]

    def test_historical_response_without_echo_is_502_not_mislabeled(
        self, monkeypatch
    ):
        # An upstream that predates the as-of contract returns neither
        # as_of_resolved nor teo — refuse rather than pin a wrong date.
        self._patch_fetch(
            monkeypatch, {"ticker": "NVDA", "data_as_of": "2026-07-31"}
        )
        with pytest.raises(HTTPException) as exc:
            _load_stock_decompose("BW-STOCK-NVDA", "2025-06-30")
        assert exc.value.status_code == 502
        assert "as_of_resolved" in str(exc.value.detail)


class TestFetchDecomposeAsOf:
    def _patch_requests(self, monkeypatch, response: _FakeResponse):
        sent: dict = {}

        def fake_post(url, *, headers, json, timeout):  # noqa: A002
            sent["url"] = url
            sent["json"] = json
            return response

        import requests

        monkeypatch.setattr(requests, "post", fake_post)
        monkeypatch.setenv("RISKMODELS_API_KEY", "test-key")
        return sent

    def test_as_of_included_in_request_body(self, monkeypatch):
        sent = self._patch_requests(
            monkeypatch,
            _FakeResponse(200, {"ticker": "NVDA", "as_of_resolved": "2025-06-27"}),
        )
        payload = _fetch_decompose("NVDA", as_of="2025-06-30")
        assert sent["json"] == {"ticker": "NVDA", "as_of": "2025-06-30"}
        assert payload["as_of_resolved"] == "2025-06-27"

    def test_no_as_of_omits_the_field(self, monkeypatch):
        sent = self._patch_requests(
            monkeypatch, _FakeResponse(200, {"ticker": "NVDA"})
        )
        _fetch_decompose("NVDA")
        assert sent["json"] == {"ticker": "NVDA"}

    def test_upstream_as_of_404_passes_through_as_404(self, monkeypatch):
        self._patch_requests(
            monkeypatch,
            _FakeResponse(
                404,
                {"error": "No metrics found for NVDA at or before as_of=1999-01-04"},
            ),
        )
        with pytest.raises(HTTPException) as exc:
            _fetch_decompose("NVDA", as_of="1999-01-04")
        assert exc.value.status_code == 404
        assert "as_of=1999-01-04" in str(exc.value.detail)

    def test_latest_404_still_maps_to_502(self, monkeypatch):
        # Without as_of, a 404 keeps the existing upstream-fault semantics.
        self._patch_requests(
            monkeypatch, _FakeResponse(404, {"error": "Symbol not found"})
        )
        with pytest.raises(HTTPException) as exc:
            _fetch_decompose("NVDA")
        assert exc.value.status_code == 502
