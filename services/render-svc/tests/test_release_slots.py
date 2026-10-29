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


# ── per-request resolution with a TTL (ERM3-75 increment 5 review, item c) ──
# Before: CURRENT was resolved once at startup, so after two publishes without a restart render-svc read the slot
# the next publish was overwriting. Now each request resolves through live_zarr_root (60 s TTL, as the API).

from render_svc import settings as settings_mod  # noqa: E402
from render_svc.settings import LiveZarrRoot, live_zarr_root, reset_live_zarr_root_cache  # noqa: E402


@pytest.fixture
def _live(monkeypatch):
    monkeypatch.setenv("RENDER_SVC_ZARR_RELEASE_SLOTS", "1")
    monkeypatch.delenv("RENDER_SVC_ZARR_CURRENT_TTL_SECONDS", raising=False)
    reset_live_zarr_root_cache()
    yield
    reset_live_zarr_root_cache()


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_live_root_follows_flips_within_one_ttl(_live):
    objects = {"gs://b/eodhd/CURRENT": json.dumps({"slot": "a", "release_id": "r1"})}
    read, calls = _reader(objects)
    clock = _Clock()
    assert live_zarr_root("gs://b/eodhd", read_text=read, now=clock) == LiveZarrRoot("gs://b/eodhd/slots/a", "a:r1")
    objects["gs://b/eodhd/CURRENT"] = json.dumps({"slot": "b", "release_id": "r2"})
    clock.t += 30
    assert live_zarr_root("gs://b/eodhd", read_text=read, now=clock).uri == "gs://b/eodhd/slots/a"  # inside TTL
    clock.t += 31
    assert live_zarr_root("gs://b/eodhd", read_text=read, now=clock) == LiveZarrRoot("gs://b/eodhd/slots/b", "b:r2")
    # second publish goes into a and flips back: same URI as the first answer, new release
    objects["gs://b/eodhd/CURRENT"] = json.dumps({"slot": "a", "release_id": "r3"})
    clock.t += 61
    assert live_zarr_root("gs://b/eodhd", read_text=read, now=clock) == LiveZarrRoot("gs://b/eodhd/slots/a", "a:r3")
    assert len(calls) == 3


def test_live_root_ttl_env_and_keep_last_good(_live, monkeypatch):
    monkeypatch.setenv("RENDER_SVC_ZARR_CURRENT_TTL_SECONDS", "5")
    objects = {"gs://b/eodhd/CURRENT": json.dumps({"slot": "b", "release_id": "r2"})}
    read, _ = _reader(objects)
    clock = _Clock()
    assert live_zarr_root("gs://b/eodhd", read_text=read, now=clock).uri == "gs://b/eodhd/slots/b"

    def boom(uri: str):
        raise RuntimeError("transient")

    clock.t += 6
    # an unreadable CURRENT keeps the last good slot instead of dropping to the fixed prefix
    assert live_zarr_root("gs://b/eodhd", read_text=boom, now=clock).uri == "gs://b/eodhd/slots/b"
    # an absent CURRENT is an answer: the fixed root
    clock.t += 6
    assert live_zarr_root("gs://b/eodhd", read_text=_reader({})[0], now=clock) == LiveZarrRoot("gs://b/eodhd")


def test_live_root_off_or_local_never_reads(monkeypatch):
    monkeypatch.delenv("RENDER_SVC_ZARR_RELEASE_SLOTS", raising=False)
    read, calls = _reader({"gs://b/eodhd/CURRENT": json.dumps({"slot": "b"})})
    assert live_zarr_root("gs://b/eodhd", read_text=read) == LiveZarrRoot("gs://b/eodhd")
    monkeypatch.setenv("RENDER_SVC_ZARR_RELEASE_SLOTS", "1")
    assert live_zarr_root("/data/eodhd", read_text=read) == LiveZarrRoot("/data/eodhd")
    assert calls == []


def test_load_from_env_keeps_the_configured_root(_live, monkeypatch):
    monkeypatch.setenv("RENDER_SVC_ZARR_ROOT_URI", "gs://b/eodhd")
    monkeypatch.setattr(settings_mod, "_default_read_text",
                        lambda uri: json.dumps({"slot": "b", "release_id": "r2"}))
    s = settings_mod.load_from_env()
    assert s.zarr_root_uri == "gs://b/eodhd"      # requests resolve it; the startup answer is not frozen in
    assert live_zarr_root(s.zarr_root_uri).uri == "gs://b/eodhd/slots/b"


def test_erm3_resources_reload_when_the_release_behind_a_uri_changes(_live, monkeypatch):
    from render_svc import app as app_module
    from render_svc.settings import Settings

    pointer = {"v": json.dumps({"slot": "a", "release_id": "r1"})}
    monkeypatch.setattr(settings_mod, "_default_read_text", lambda uri: pointer["v"])
    monkeypatch.setenv("RENDER_SVC_ZARR_CURRENT_TTL_SECONDS", "0")
    opened: list[str] = []

    import functools

    @functools.lru_cache(maxsize=1)
    def loader(uri: str):
        opened.append(uri)
        return object(), {"X": uri}

    monkeypatch.setattr(app_module, "_load_erm3_resources", loader)
    app_module._erm3_release_loaded.clear()
    s = Settings(bucket="b", prefix="snapshots", generated_utc_anchor=None, log_level="INFO",
                 persist_renders=False, live_render=False, zarr_root_uri="gs://b/eodhd")
    assert app_module._erm3_resources(s)[2] == "gs://b/eodhd/slots/a"
    assert app_module._erm3_resources(s)[2] == "gs://b/eodhd/slots/a"
    assert opened == ["gs://b/eodhd/slots/a"]                       # cached while the release is unchanged
    pointer["v"] = json.dumps({"slot": "b", "release_id": "r2"})
    assert app_module._erm3_resources(s)[2] == "gs://b/eodhd/slots/b"
    pointer["v"] = json.dumps({"slot": "a", "release_id": "r3"})   # slot a re-used by the next publish
    assert app_module._erm3_resources(s)[2] == "gs://b/eodhd/slots/a"
    assert opened == ["gs://b/eodhd/slots/a", "gs://b/eodhd/slots/b", "gs://b/eodhd/slots/a"]
    app_module._erm3_release_loaded.clear()
