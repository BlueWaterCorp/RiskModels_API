"""Date, source and cache contracts for RMGraph stock return paths."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from render_svc import artifacts
from render_svc.stock_return_paths import load_return_paths


@pytest.fixture
def source():
    return json.loads((Path(__file__).parent / "fixtures/nvda-return-paths-20260911.json").read_text())


def install_source(monkeypatch, source):
    calls = []
    monkeypatch.setenv("RISKMODELS_API_KEY", "unit-test-only")
    def get(url, **kwargs):
        calls.append((url, kwargs))
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: copy.deepcopy(source))
    monkeypatch.setattr("render_svc.stock_return_paths.requests.get", get)
    return calls


def test_cutoff_uses_observed_dates_and_preserves_exact_values(monkeypatch, source):
    calls = install_source(monkeypatch, source)
    result, resolved = load_return_paths("NVDA", "2026-09-10", "3m")
    assert resolved == "2026-09-10"
    assert result["dates"] == source["dates"][:-1]
    assert result["l3_residual_return"] == source["l3_residual_return"][:-1]
    assert calls[0][0].endswith("/returns-decomposition")
    assert calls[0][1]["params"]["ticker"] == "NVDA"


def test_weekend_resolves_to_last_observed_close(monkeypatch, source):
    install_source(monkeypatch, source)
    _, resolved = load_return_paths("NVDA", "2026-09-12", "3m")
    assert resolved == "2026-09-11"


@pytest.mark.parametrize("mutation", ["ticker", "missing", "null", "duplicate", "boolean", "metadata"])
def test_bad_upstream_data_is_not_plotted(monkeypatch, source, mutation):
    if mutation == "ticker":
        source["ticker"] = "OTHER"
    elif mutation == "missing":
        source["l3_residual_return"].pop()
    elif mutation == "null":
        source["l3_residual_return"][1] = None
    elif mutation == "duplicate":
        source["dates"][1] = source["dates"][0]
    elif mutation == "metadata":
        source["_metadata"] = "invalid"
    else:
        source["gross_return"][1] = True
    install_source(monkeypatch, source)
    with pytest.raises(HTTPException) as err:
        load_return_paths("NVDA", "2026-09-11", "3m")
    assert err.value.status_code == 502


def test_unavailable_cutoff_does_not_fall_forward(monkeypatch, source):
    install_source(monkeypatch, source)
    with pytest.raises(HTTPException) as err:
        load_return_paths("NVDA", "2025-01-01", "3m")
    assert err.value.status_code == 404


@pytest.mark.parametrize("window", ["3y", "bad"])
def test_unsupported_window_fails_before_source_call(monkeypatch, source, window):
    calls = install_source(monkeypatch, source)
    with pytest.raises(HTTPException) as err:
        load_return_paths("NVDA", "2026-09-11", window)
    assert err.value.status_code == 422
    assert calls == []


def test_registry_uses_returns_loader_and_reuses_dated_bytes(monkeypatch, source, store):
    calls = install_source(monkeypatch, source)
    mod = SimpleNamespace(APPLICABLE_SUBJECT_KINDS=("stock",), RENDER_PARAMS=("window",),
                          render_data=lambda payload, **kw: {"dates": payload["dates"], "params": kw})
    monkeypatch.setattr(artifacts, "_import_artifact_module", lambda *_: mod)
    request = artifacts.ArtifactRenderRequest(slug="cumulative_return_paths", version="v1", subject_id="BW-STOCK-NVDA",
                                              as_of="2026-09-11", format="json", params={"window": "3m"})
    first = artifacts.render_artifact(request, store=store, prefix="snapshots")
    second = artifacts.render_artifact(request, store=store, prefix="snapshots")
    assert first == second
    assert len(calls) == 1
    assert first[3] == "2026-09-11"
    assert ".window-3m.json" in first[2]
    assert json.loads(first[0])["dates"] == source["dates"]
    changed = request.model_copy(update={"params": artifacts.ArtifactParams(window="6m")})
    third = artifacts.render_artifact(changed, store=store, prefix="snapshots")
    assert third[2] != first[2]
    assert third[5] != first[5]
