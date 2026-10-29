"""render-svc zarr root through the release-slot pointer (ERM3-75 increment 5).

``RENDER_SVC_ZARR_RELEASE_SLOTS=1`` resolves ``<root>/CURRENT`` to ``<root>/slots/<slot>`` at startup; off
(default) the root is unchanged and CURRENT is never read. No network: the object reader is injected.
"""
from __future__ import annotations

import json

import pytest

from render_svc.settings import resolve_zarr_root_uri


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("RENDER_SVC_ZARR_RELEASE_SLOTS", raising=False)


def _reader(objects: dict[str, str]):
    calls: list[str] = []

    def read(uri: str):
        calls.append(uri)
        return objects.get(uri)

    return read, calls


def test_switch_off_returns_root_unchanged():
    read, calls = _reader({"gs://b/eodhd/CURRENT": json.dumps({"slot": "b"})})
    assert resolve_zarr_root_uri("gs://b/eodhd", read_text=read) == "gs://b/eodhd"
    assert calls == []


def test_switch_on_resolves_slot(monkeypatch):
    monkeypatch.setenv("RENDER_SVC_ZARR_RELEASE_SLOTS", "1")
    read, calls = _reader({"gs://b/eodhd/CURRENT": json.dumps({"slot": "b", "release_id": "r2"})})
    assert resolve_zarr_root_uri("gs://b/eodhd/", read_text=read) == "gs://b/eodhd/slots/b"
    assert calls == ["gs://b/eodhd/CURRENT"]


def test_switch_on_falls_back(monkeypatch):
    monkeypatch.setenv("RENDER_SVC_ZARR_RELEASE_SLOTS", "1")
    read, _ = _reader({})
    assert resolve_zarr_root_uri("gs://b/eodhd", read_text=read) == "gs://b/eodhd"
    read, _ = _reader({"gs://b/eodhd/CURRENT": "not json"})
    assert resolve_zarr_root_uri("gs://b/eodhd", read_text=read) == "gs://b/eodhd"
    read, _ = _reader({"gs://b/eodhd/CURRENT": json.dumps({"slot": "zz"})})
    assert resolve_zarr_root_uri("gs://b/eodhd", read_text=read) == "gs://b/eodhd"

    def boom(uri: str):
        raise RuntimeError("no credentials")

    assert resolve_zarr_root_uri("gs://b/eodhd", read_text=boom) == "gs://b/eodhd"
    # a local root is never resolved
    assert resolve_zarr_root_uri("/data/zarr/eodhd", read_text=read) == "/data/zarr/eodhd"
