"""``GET /portfolio-evolution/health`` — diagnostic probe tests (MASTER_BACKLOG P.9).

The ``POST /portfolio-evolution`` endpoint converts every ERM3-zarr open
failure into a generic 503 ``"ERM3 monthly unavailable: <generic str>"``,
hiding the underlying error class. The health endpoint always probes
fresh and returns the structured error so operators can diagnose
``gcsfs auth vs missing zarr vs xarray import`` without enabling debug
logging in production.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from render_svc import app as app_module
from render_svc.app import _make_app
from render_svc.settings import Settings

from conftest import FakeStore  # tests/ is on sys.path via pyproject.toml


def _settings() -> Settings:
    return Settings(
        bucket="rm_api_data_test",
        prefix="snapshots",
        generated_utc_anchor=None,
        log_level="INFO",
        persist_renders=False,
        live_render=False,
        zarr_root_uri="gs://rm_api_data_test/eodhd",
    )


def _build_client(monkeypatch, load_fn) -> TestClient:
    """Inject a stub _load_erm3_resources and return a TestClient."""
    app_module._load_erm3_resources.cache_clear()
    monkeypatch.setattr(app_module, "_load_erm3_resources", load_fn)
    app = _make_app(_settings(), FakeStore())
    return TestClient(app)


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------


def test_health_returns_ok_when_zarr_loads(monkeypatch):
    """Happy path: zarr opens cleanly, bridge populated → 200 with the
    URI and bridge size so an operator can verify the right zarr is
    mounted, not just that the call didn't crash."""
    fake_bridge = {"AAPL": "BW-FIGI-AAPL", "MSFT": "BW-FIGI-MSFT"}
    client = _build_client(monkeypatch, lambda _uri: (object(), fake_bridge))
    r = client.get("/portfolio-evolution/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["zarr_root_uri"] == "gs://rm_api_data_test/eodhd"
    assert body["n_tickers_in_bridge"] == 2


# ---------------------------------------------------------------------------
# Failure path — the headline P.9 fix: structured error in the 503 body
# ---------------------------------------------------------------------------


def test_health_503_surfaces_filenotfound_class_and_message(monkeypatch):
    """Missing zarr — operator sees error_class='FileNotFoundError'
    and the message, NOT the opaque generic 'ERM3 monthly unavailable'
    string the POST endpoint emits."""
    def _missing(_uri):
        raise FileNotFoundError("ds_erm3_monthly_SPY_uni_mc_3000.zarr: not found in test bucket")

    client = _build_client(monkeypatch, _missing)
    r = client.get("/portfolio-evolution/health")
    assert r.status_code == 503
    body = r.json()
    detail = body["detail"]
    assert detail["status"] == "error"
    assert detail["error_class"] == "FileNotFoundError"
    assert "not found in test bucket" in detail["error_message"]
    assert detail["zarr_root_uri"] == "gs://rm_api_data_test/eodhd"


def test_health_503_includes_module_for_third_party_errors(monkeypatch):
    """An auth-class error from gcsfs (or any third party) reports the
    error_module so the operator knows where to look."""
    class FakeCredentialsError(Exception):
        """Simulates google.auth.exceptions.DefaultCredentialsError."""

    FakeCredentialsError.__module__ = "google.auth.exceptions"

    def _no_creds(_uri):
        raise FakeCredentialsError("Could not automatically determine credentials")

    client = _build_client(monkeypatch, _no_creds)
    r = client.get("/portfolio-evolution/health")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["error_class"] == "FakeCredentialsError"
    assert detail["error_module"] == "google.auth.exceptions"


def test_health_does_not_swallow_generic_exceptions(monkeypatch):
    """A bare Exception (not a recognized class) still produces a clean
    structured 503 — no special-casing required."""
    def _generic(_uri):
        raise Exception("something unexpected")

    client = _build_client(monkeypatch, _generic)
    r = client.get("/portfolio-evolution/health")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["error_class"] == "Exception"
    assert detail["error_message"] == "something unexpected"


# ---------------------------------------------------------------------------
# Independence from POST endpoint behavior
# ---------------------------------------------------------------------------


def test_health_endpoint_does_not_require_request_body(monkeypatch):
    """GET-with-no-body must work — no PortfolioEvolutionRequest validation
    so the endpoint stays curl-able directly."""
    client = _build_client(monkeypatch, lambda _uri: (object(), {}))
    r = client.get("/portfolio-evolution/health")
    assert r.status_code == 200
