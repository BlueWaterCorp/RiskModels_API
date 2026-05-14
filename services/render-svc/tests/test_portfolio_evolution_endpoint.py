"""End-to-end FastAPI test for ``POST /portfolio-evolution`` (The Analyst M4).

Uses the same local 13F-derived fixtures as the kernel tests, with the
``_load_erm3_resources`` LRU cache monkey-patched to a path-based loader so
we don't hit GCS in tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import xarray as xr
from fastapi.testclient import TestClient

from render_svc import app as app_module
from render_svc.app import _make_app
from render_svc.settings import Settings

from conftest import FakeStore  # tests/ is on sys.path via pyproject.toml


FIXTURES = Path(__file__).parent / "fixtures" / "m4"
ERM3_MONTHLY_CANDIDATES = [
    Path("/Volumes/ext_2t/ERM3_Data/stock_data/zarr/eodhd/ds_erm3_monthly_SPY_uni_mc_3000.zarr"),
    Path("/Volumes/ext_2t/Funds_DAG_data/funds_data/zarr/ds_erm3_monthly_SPY_uni_mc_3000.zarr"),
]


def _local_erm3() -> Path | None:
    for p in ERM3_MONTHLY_CANDIDATES:
        if p.is_dir():
            return p
    return None


@pytest.fixture
def settings_for_test() -> Settings:
    return Settings(
        bucket="rm_api_data_test",
        prefix="snapshots",
        generated_utc_anchor=None,
        log_level="INFO",
        persist_renders=False,
        live_render=False,
        zarr_root_uri="gs://rm_api_data_test/eodhd",  # mocked at the loader
    )


@pytest.fixture
def client(monkeypatch, settings_for_test) -> TestClient:
    p = _local_erm3()
    if p is None:
        pytest.skip("No local ERM3 monthly zarr mounted")
    em = xr.open_zarr(p)
    tickers = em["ticker"].values
    symbols = em["symbol"].values
    bridge: dict[str, str] = {}
    for t, s in zip(tickers, symbols):
        ts = str(t).strip().upper()
        if not ts or ts == "NAN":
            continue
        bridge[ts] = str(s)

    # Bypass the GCS loader; cache the local copy.
    app_module._load_erm3_resources.cache_clear()
    monkeypatch.setattr(app_module, "_load_erm3_resources", lambda _uri: (em, bridge))

    app = _make_app(settings_for_test, FakeStore())
    return TestClient(app)


def _load_input(slug: str) -> dict:
    return json.loads((FIXTURES / f"{slug}_input.json").read_text())


def test_portfolio_evolution_endpoint_berkshire(client: TestClient):
    inp = _load_input("berkshire")
    resp = client.post(
        "/portfolio-evolution",
        json={
            "portfolio_id": "13f/0001067983",
            "portfolio_history": inp["portfolio_history"],
            "include_full_breakdown": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["portfolio_id"] == "13f/0001067983"
    assert body["window"]["from_date"] == inp["first_as_of"]
    assert body["window"]["to_date"] == inp["last_as_of"]
    ra = body["return_attribution"]
    assert ra is not None
    assert isinstance(ra["trade_effect_bps"], int)
    assert isinstance(ra["noise_floor_bps"], int)
    assert body["variance_share_attribution"] is not None
    assert body["_metadata"]["coverage_in_erm3"] > 0.5
    assert "_monthly_breakdown" not in body  # default false

    assert resp.headers.get("X-Kernel-Version", "").startswith("m4.v1.")
    assert resp.headers.get("X-Coverage-In-Erm3") is not None


def test_portfolio_evolution_endpoint_full_breakdown(client: TestClient):
    inp = _load_input("pershing")
    resp = client.post(
        "/portfolio-evolution",
        json={
            "portfolio_id": "13f/0001336528",
            "portfolio_history": inp["portfolio_history"],
            "include_full_breakdown": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["_monthly_breakdown"] is not None
    assert len(body["_monthly_breakdown"]) >= 12


def test_portfolio_evolution_endpoint_single_point(client: TestClient):
    """One snapshot in history → return_attribution is null per §5b."""
    resp = client.post(
        "/portfolio-evolution",
        json={
            "portfolio_id": "test/single",
            "portfolio_history": [
                {
                    "as_of_date": "2026-05-12",
                    "holdings": [{"ticker": "NVDA", "weight": 1.0}],
                    "ingest_adapter": "paste",
                }
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["return_attribution"] is None
    assert body["window"]["n_dated_points"] == 1
    assert "First snapshot" in body["narrative_v1"]


def test_portfolio_evolution_endpoint_validates_payload(client: TestClient):
    """Missing portfolio_id → 422 from FastAPI's pydantic validation."""
    resp = client.post(
        "/portfolio-evolution",
        json={"portfolio_history": []},
    )
    assert resp.status_code == 422
