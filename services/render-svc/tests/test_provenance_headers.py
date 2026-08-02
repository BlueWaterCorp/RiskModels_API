"""G.41 provenance completion — `X-Artifact-Evidence-Class` / `X-Artifact-Coverage-Fraction`.

The core honesty rule under test: evidence class is emitted ONLY where the
holdings vocabulary genuinely applies (fund→nport, filer_13f→13f,
client_portfolio→user) and OMITTED for stock/etf/cohort; coverage fraction is
emitted ONLY when the request genuinely carries one (a client_portfolio
payload's `coverage_fraction`), never defaulted to 1.0.

App-level tests go through the real `POST /artifacts/render` path with the
same fakes `test_artifacts.py` uses (fake bwmacro artifact module + fake
loaders), so the assertions are on rendered responses, not on stubs of the
render itself.
"""

from __future__ import annotations

import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from render_svc.app import _make_app
from render_svc.artifacts import (
    ArtifactRenderRequest,
    coverage_fraction_for,
    evidence_class_for,
)
from render_svc.settings import Settings

from conftest import FakeStore  # tests/ is on sys.path via pyproject.toml
from test_artifacts import (
    FakeFundData,
    _install_fake_bwmacro_artifact,
    _patch_get_data_for_f1,
)


# ── Unit: evidence_class_for ──────────────────────────────────────────────


class TestEvidenceClassFor:
    def test_fund_is_nport(self):
        assert evidence_class_for("BW-FUND-S000004563") == "nport"

    def test_filer_is_13f(self):
        assert evidence_class_for("BW-FILER-0001067983") == "13f"

    def test_client_portfolio_is_user(self):
        assert evidence_class_for("BW-PORTFOLIO-abc123") == "user"

    def test_stock_omitted(self):
        # A single listed security is not holdings-backed; no invented value.
        assert evidence_class_for("BW-STOCK-NVDA") is None

    def test_etf_omitted(self):
        assert evidence_class_for("BW-ETF-IVV") is None

    def test_cohort_omitted(self):
        assert evidence_class_for("BW-COHORT-RES-XYZ") is None

    def test_unknown_prefix_still_422s(self):
        with pytest.raises(HTTPException) as exc_info:
            evidence_class_for("NOT-A-SUBJECT")
        assert exc_info.value.status_code == 422


# ── Unit: coverage_fraction_for ───────────────────────────────────────────


def _portfolio_req(subject_payload):
    return ArtifactRenderRequest(
        slug="top_holdings_erm_stacked",
        version="v1",
        subject_id="BW-PORTFOLIO-",
        as_of="latest",
        format="json",
        subject_payload=subject_payload,
    )


class TestCoverageFractionFor:
    def test_portfolio_payload_carrying_coverage(self):
        req = _portfolio_req(
            {"positions": [{"ticker": "NVDA", "weight": 1.0}], "coverage_fraction": 0.85}
        )
        assert coverage_fraction_for(req) == 0.85

    def test_portfolio_payload_without_coverage_is_none(self):
        # The loader does not know it → no value, NOT a default 1.0.
        req = _portfolio_req({"positions": [{"ticker": "NVDA", "weight": 1.0}]})
        assert coverage_fraction_for(req) is None

    def test_non_portfolio_subject_is_none(self):
        req = ArtifactRenderRequest(
            slug="top_holdings_erm_stacked",
            version="v1",
            subject_id="BW-FUND-S000004563",
            as_of="latest",
            format="json",
        )
        assert coverage_fraction_for(req) is None

    def test_explicit_null_coverage_treated_as_unknown(self):
        req = _portfolio_req(
            {"positions": [{"ticker": "NVDA", "weight": 1.0}], "coverage_fraction": None}
        )
        assert coverage_fraction_for(req) is None

    @pytest.mark.parametrize("bad", ["0.85", -0.1, 1.5, True, [0.5]])
    def test_malformed_coverage_422s_rather_than_vanishing(self, bad):
        req = _portfolio_req(
            {"positions": [{"ticker": "NVDA", "weight": 1.0}], "coverage_fraction": bad}
        )
        with pytest.raises(HTTPException) as exc_info:
            coverage_fraction_for(req)
        assert exc_info.value.status_code == 422

    def test_boundary_values_accepted(self):
        assert coverage_fraction_for(
            _portfolio_req({"positions": [{"t": 1}], "coverage_fraction": 0.0})
        ) == 0.0
        assert coverage_fraction_for(
            _portfolio_req({"positions": [{"t": 1}], "coverage_fraction": 1.0})
        ) == 1.0


# ── App-level: headers on real rendered responses ─────────────────────────


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def client(store) -> TestClient:
    settings = Settings(
        bucket="rm_api_data_test",
        prefix="snapshots",
        generated_utc_anchor=None,
        log_level="INFO",
        persist_renders=False,
        live_render=False,
        zarr_root_uri="gs://rm_api_data_test/eodhd",
    )
    return TestClient(_make_app(settings, store))


class TestArtifactRenderProvenanceHeaders:
    def test_fund_artifact_carries_evidence_class_nport(self, client, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund",),
            render_data_result={"slug": "top_holdings_erm_stacked", "rows": []},
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "top_holdings_erm_stacked",
                "version": "v1",
                "subject_id": "BW-FUND-S000004563",
                "as_of": "latest",
                "format": "json",
            },
        )

        assert resp.status_code == 200
        assert resp.headers["X-Artifact-Evidence-Class"] == "nport"
        # No loader knows a coverage fraction for a fund render → omitted.
        assert "X-Artifact-Coverage-Fraction" not in resp.headers
        # The pre-existing trio is unchanged.
        assert resp.headers["X-Artifact-Resolved-As-Of"] == "2025-11-30"
        assert "X-Artifact-GCS-Path" in resp.headers
        assert "X-Artifact-Receipt-Id" in resp.headers

    def test_stock_artifact_carries_no_evidence_class(self, client, monkeypatch):
        import render_svc.artifacts as artifacts_mod

        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="l3_explained_risk_hbar",
            version="v1",
            applicable=("stock",),
            render_data_result={"slug": "l3_explained_risk_hbar", "rows": []},
        )
        # The shared fake adapters module only seeds fund adapters; add the
        # stock one this slug resolves.
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        monkeypatch.setattr(
            adapters_mod,
            "stock_l3_exposure_from_decompose",
            lambda payload: payload,
            raising=False,
        )
        monkeypatch.setattr(
            artifacts_mod,
            "_fetch_decompose",
            lambda ticker: {"ticker": ticker, "data_as_of": "2026-07-31"},
        )

        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "l3_explained_risk_hbar",
                "version": "v1",
                "subject_id": "BW-STOCK-NVDA",
                "as_of": "latest",
                "format": "json",
            },
        )

        assert resp.status_code == 200
        # Stock panels are not holdings-backed: header OMITTED, not invented.
        assert "X-Artifact-Evidence-Class" not in resp.headers
        assert "X-Artifact-Coverage-Fraction" not in resp.headers
        assert resp.headers["X-Artifact-Resolved-As-Of"] == "2026-07-31"

    def test_filer_cache_hit_carries_evidence_class_13f(self, client, store):
        # filer_13f is a pre-rendered kind — seed the exact GCS object.
        path = (
            "snapshots/artifacts/entity_header@v1/BW-FILER-0001067983/2026-03-31.json"
        )
        store.write(path, b'{"cached":true}', content_type="application/json")

        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "entity_header",
                "version": "v1",
                "subject_id": "BW-FILER-0001067983",
                "as_of": "2026-03-31",
                "format": "json",
            },
        )

        assert resp.status_code == 200
        assert resp.headers["X-Artifact-Evidence-Class"] == "13f"
        assert "X-Artifact-Coverage-Fraction" not in resp.headers

    def test_portfolio_with_coverage_emits_both_headers(self, client, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund", "client_portfolio"),
            render_data_result={"slug": "top_holdings_erm_stacked", "rows": []},
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        monkeypatch.setattr(
            adapters_mod,
            "holdings_from_client_portfolio",
            lambda positions, top_n=12: positions[:top_n],
            raising=False,
        )

        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "top_holdings_erm_stacked",
                "version": "v1",
                "subject_id": "BW-PORTFOLIO-",
                "as_of": "latest",
                "format": "json",
                "subject_payload": {
                    "positions": [{"ticker": "NVDA", "weight": 0.6}],
                    "coverage_fraction": 0.85,
                },
            },
        )

        assert resp.status_code == 200
        assert resp.headers["X-Artifact-Evidence-Class"] == "user"
        assert resp.headers["X-Artifact-Coverage-Fraction"] == "0.85"

    def test_portfolio_without_coverage_omits_coverage_header(self, client, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund", "client_portfolio"),
            render_data_result={"slug": "top_holdings_erm_stacked", "rows": []},
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        monkeypatch.setattr(
            adapters_mod,
            "holdings_from_client_portfolio",
            lambda positions, top_n=12: positions[:top_n],
            raising=False,
        )

        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "top_holdings_erm_stacked",
                "version": "v1",
                "subject_id": "BW-PORTFOLIO-",
                "as_of": "latest",
                "format": "json",
                "subject_payload": {"positions": [{"ticker": "NVDA", "weight": 0.6}]},
            },
        )

        assert resp.status_code == 200
        assert resp.headers["X-Artifact-Evidence-Class"] == "user"
        # Unknown coverage → omitted header, never a fabricated 1.0.
        assert "X-Artifact-Coverage-Fraction" not in resp.headers

    def test_malformed_coverage_422s_before_rendering(self, client):
        resp = client.post(
            "/artifacts/render",
            json={
                "slug": "top_holdings_erm_stacked",
                "version": "v1",
                "subject_id": "BW-PORTFOLIO-",
                "as_of": "latest",
                "format": "json",
                "subject_payload": {
                    "positions": [{"ticker": "NVDA", "weight": 0.6}],
                    "coverage_fraction": 1.5,
                },
            },
        )
        assert resp.status_code == 422
        assert "coverage_fraction" in resp.text
