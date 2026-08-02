"""G.45 — ``holdings_active_panel`` through ``render_artifact``.

The panel's loader is ``GET /api/data/benchmark-fit`` (the
``fitWeightVectors`` kernel); the renderer module is SDK-hosted
(``riskmodels.snapshots.artifacts.holdings_active_panel.v1`` — this venv
has no bwmacro, so these tests also exercise the import fallback for
real). Upstream HTTP is faked at ``requests.get``; everything from the
loader boundary inward runs the production code path.
"""

from __future__ import annotations

import json
import types

import pytest
from fastapi import HTTPException

from render_svc.artifacts import (
    ArtifactRenderRequest,
    _import_artifact_module,
    render_artifact,
)

PREFIX = "snapshots"

FIT = {
    "fit_schema_version": "benchmark-fit/1.1",
    "subject_id": "BW-FUND-S000000008",
    "subject_source_kind": "fund",
    "benchmark_context_id": "ff_own",
    "benchmark_name": "Own-holdings free-float cap benchmark",
    "benchmark_kind": "ff_own",
    "subject_teo": "2026-06-30",
    "benchmark_teo": "2026-06-30",
    "n_subject_holdings": 25,
    "n_benchmark_constituents": 25,
    "n_overlap": 25,
    "active_share": 0.227,
    "active_weight_rms": 0.1266,
    "weight_in_benchmark": 1.0,
    "benchmark_coverage": 1.0,
    "top_overweights": [
        {"bw_sym_id": "BW-A", "subject_weight": 0.03, "benchmark_weight": 0.003, "active_weight": 0.027},
    ],
    "top_underweights": [
        {"bw_sym_id": "BW-C", "subject_weight": 0.098, "benchmark_weight": 0.177, "active_weight": -0.079},
    ],
    "benchmark_provenance": {"cap_var": "ff_own_cap", "cap_coverage": 0.996},
}


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _env_and_labels(monkeypatch):
    monkeypatch.setenv("RISKMODELS_API_KEY", "rm_agent_test")
    # Deterministic label resolution (no Supabase in tests).
    monkeypatch.setattr(
        "riskmodels.snapshots._fund_data._resolve_holdings_metadata",
        lambda syms: {},
    )


@pytest.fixture
def upstream(monkeypatch):
    """Fake requests.get capturing params; programmable response."""
    calls: list[dict] = []
    holder = types.SimpleNamespace(response=_FakeResponse(200, FIT), calls=calls)

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append({"url": url, "params": dict(params or {})})
        return holder.response

    monkeypatch.setattr("requests.get", fake_get)
    return holder


def _req(**kw) -> ArtifactRenderRequest:
    base = dict(
        slug="holdings_active_panel",
        version="v1",
        subject_id="BW-FUND-S000000008",
        as_of="latest",
        format="json",
    )
    base.update(kw)
    return ArtifactRenderRequest(**base)


def test_import_fallback_resolves_sdk_module():
    # No bwmacro in this venv — the fallback must find the SDK module.
    mod = _import_artifact_module("holdings_active_panel", "v1")
    assert mod.ARTIFACT_SLUG == "holdings_active_panel"
    assert mod.__name__.startswith("riskmodels.snapshots.artifacts.")


def test_default_render_uses_ff_own_and_serves_panel_json(store, upstream):
    raw, ctype, path, resolved, cache_control, receipt = render_artifact(
        _req(), store=store, prefix=PREFIX
    )
    # Loader called the fit endpoint with the ff_own default.
    call = upstream.calls[0]
    assert call["url"].endswith("/data/benchmark-fit")
    assert call["params"]["benchmark"] == "ff_own"
    assert call["params"]["top"] == 10
    assert "as_of" not in call["params"]

    body = json.loads(raw)
    assert body["active_share"] == 0.227
    assert body["benchmark"]["label"] == (
        "vs ff_own — Own-holdings free-float cap benchmark · benchmark as of 2026-06-30"
    )
    assert resolved == "2026-06-30"  # the kernel's subject_teo
    # Default params → legacy key shape (no params fragment).
    assert path == f"{PREFIX}/artifacts/holdings_active_panel@v1/BW-FUND-S000000008/2026-06-30.json"
    assert store.head(path)


def test_benchmark_param_lowercased_into_cache_key(store, upstream):
    upstream.response = _FakeResponse(
        200, {**FIT, "benchmark_context_id": "cell_large-value"}
    )
    _, _, path, _, _, _ = render_artifact(
        _req(params={"benchmark": "CELL_Large-Value"}),
        store=store,
        prefix=PREFIX,
    )
    assert upstream.calls[0]["params"]["benchmark"] == "cell_large-value"
    assert ".benchmark-cell_large-value" in path


def test_development_bench_409_propagates_and_nothing_is_written(store, upstream):
    upstream.response = _FakeResponse(
        409,
        {"error": "benchmark 'BW-BENCH-SPY' is under development", "status": "development"},
    )
    with pytest.raises(HTTPException) as exc:
        render_artifact(
            _req(params={"benchmark": "SPY"}), store=store, prefix=PREFIX
        )
    # The readiness refusal reaches the caller as-is — never weakened,
    # never silently swapped for another benchmark.
    assert exc.value.status_code == 409
    assert "under development" in str(exc.value.detail)
    assert store.objects == {}


def test_historical_as_of_passes_through_and_resolves_served_teo(store, upstream):
    upstream.response = _FakeResponse(
        200, {**FIT, "subject_teo": "2024-06-28", "benchmark_teo": "2024-06-28"}
    )
    _, _, path, resolved, cache_control, _ = render_artifact(
        _req(as_of="2024-06-30"), store=store, prefix=PREFIX
    )
    assert upstream.calls[0]["params"]["as_of"] == "2024-06-30"
    assert resolved == "2024-06-28"
    assert "2024-06-28.json" in path
    assert "immutable" in cache_control


def test_pit_violation_is_a_502(store, upstream):
    upstream.response = _FakeResponse(200, {**FIT, "subject_teo": "2026-06-30"})
    with pytest.raises(HTTPException) as exc:
        render_artifact(_req(as_of="2024-06-30"), store=store, prefix=PREFIX)
    assert exc.value.status_code == 502
    assert "PIT invariant" in str(exc.value.detail)


def test_upstream_404_maps_to_404(store, upstream):
    upstream.response = _FakeResponse(404, {"error": "No surface available"})
    with pytest.raises(HTTPException) as exc:
        render_artifact(_req(), store=store, prefix=PREFIX)
    assert exc.value.status_code == 404


def test_missing_api_key_is_503(store, upstream, monkeypatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    monkeypatch.delenv("RENDER_SVC_RISKMODELS_API_KEY", raising=False)
    with pytest.raises(HTTPException) as exc:
        render_artifact(_req(), store=store, prefix=PREFIX)
    assert exc.value.status_code == 503


def test_benchmark_param_rejected_on_other_slugs(store, upstream):
    with pytest.raises(HTTPException) as exc:
        render_artifact(
            _req(slug="cumulative_return_strip", params={"benchmark": "ff_own"}),
            store=store,
            prefix=PREFIX,
        )
    assert exc.value.status_code == 422
    assert "not applicable" in str(exc.value.detail)


def test_cache_hit_skips_the_loader(store, upstream):
    path = f"{PREFIX}/artifacts/holdings_active_panel@v1/BW-FUND-S000000008/2026-06-30.json"
    # Seeding the cache requires knowing the resolved as_of — pin it.
    store.write(path, b'{"cached": true}', content_type="application/json")
    raw, *_ = render_artifact(_req(as_of="2026-06-30"), store=store, prefix=PREFIX)
    # The loader still runs (it resolves subject_teo), but the render is
    # served from the cache: bytes are the seeded object, untouched.
    assert json.loads(raw) == {"cached": True}
