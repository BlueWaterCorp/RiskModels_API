"""``load_from_env`` — silent-default visibility tests (MASTER_BACKLOG P.6 + P.8).

When ``RENDER_SVC_BUCKET`` or ``RENDER_SVC_ZARR_ROOT_URI`` aren't set,
the service used to silently fall back to ``rm_api_data`` / ``gs://rm_api_data/eodhd``
with no operator-visible signal. The fix logs a WARNING for each default
actually used, so a startup log line tells the operator exactly which
env var is missing.
"""

from __future__ import annotations

import logging

import pytest

from render_svc.settings import load_from_env


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    """Strip the relevant env vars so each test starts from a known state."""
    for var in (
        "RENDER_SVC_BUCKET",
        "RENDER_SVC_ZARR_ROOT_URI",
        "RENDER_SVC_PREFIX",
        "RENDER_SVC_GENERATED_UTC",
        "RENDER_SVC_LOG_LEVEL",
        "RENDER_SVC_PERSIST_RENDERS",
        "RENDER_SVC_LIVE_RENDER",
    ):
        monkeypatch.delenv(var, raising=False)


# ---------------------------------------------------------------------------
# P.8 — RENDER_SVC_BUCKET silent default
# ---------------------------------------------------------------------------


def test_warns_when_bucket_env_unset(caplog):
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        s = load_from_env()
    assert s.bucket == "rm_api_data"
    # Exactly one warning about the bucket default.
    bucket_warnings = [r for r in caplog.records if "RENDER_SVC_BUCKET" in r.message]
    assert len(bucket_warnings) == 1
    assert bucket_warnings[0].levelno == logging.WARNING
    assert "default bucket" in bucket_warnings[0].message
    assert "'rm_api_data'" in bucket_warnings[0].message


def test_no_warning_when_bucket_env_set(monkeypatch, caplog):
    monkeypatch.setenv("RENDER_SVC_BUCKET", "explicit-test-bucket")
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        s = load_from_env()
    assert s.bucket == "explicit-test-bucket"
    bucket_warnings = [r for r in caplog.records if "RENDER_SVC_BUCKET" in r.message]
    assert bucket_warnings == []


def test_warns_even_when_explicitly_empty_string(caplog):
    """Empty string env var is treated as unset — the operator likely
    intended to set it but botched the value."""
    import os
    os.environ["RENDER_SVC_BUCKET"] = ""
    try:
        with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
            load_from_env()
        bucket_warnings = [r for r in caplog.records if "RENDER_SVC_BUCKET" in r.message]
        assert len(bucket_warnings) == 1
    finally:
        del os.environ["RENDER_SVC_BUCKET"]


# ---------------------------------------------------------------------------
# P.6 — RENDER_SVC_ZARR_ROOT_URI silent default
# ---------------------------------------------------------------------------


def test_warns_when_zarr_root_uri_env_unset(caplog):
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        s = load_from_env()
    assert s.zarr_root_uri == "gs://rm_api_data/eodhd"
    zarr_warnings = [
        r for r in caplog.records if "RENDER_SVC_ZARR_ROOT_URI" in r.message
    ]
    assert len(zarr_warnings) == 1
    assert zarr_warnings[0].levelno == logging.WARNING
    assert "gs://rm_api_data/eodhd" in zarr_warnings[0].message


def test_no_warning_when_zarr_root_uri_env_set(monkeypatch, caplog):
    monkeypatch.setenv("RENDER_SVC_ZARR_ROOT_URI", "gs://test-research-bucket/zarrs")
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        s = load_from_env()
    assert s.zarr_root_uri == "gs://test-research-bucket/zarrs"
    zarr_warnings = [
        r for r in caplog.records if "RENDER_SVC_ZARR_ROOT_URI" in r.message
    ]
    assert zarr_warnings == []


# ---------------------------------------------------------------------------
# Independence — each warning fires independently of the other
# ---------------------------------------------------------------------------


def test_both_warnings_fire_when_both_env_vars_unset(caplog):
    """All-defaults case — both warnings fire so the operator sees the
    complete picture in one startup log scan."""
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        load_from_env()
    messages = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    assert any("RENDER_SVC_BUCKET" in m for m in messages)
    assert any("RENDER_SVC_ZARR_ROOT_URI" in m for m in messages)


def test_only_one_warning_when_only_one_unset(monkeypatch, caplog):
    """Mixed case — only the missing env var generates a warning."""
    monkeypatch.setenv("RENDER_SVC_BUCKET", "explicit-bucket")
    # RENDER_SVC_ZARR_ROOT_URI stays unset.
    with caplog.at_level(logging.WARNING, logger="render_svc.settings"):
        load_from_env()
    messages = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    assert not any("RENDER_SVC_BUCKET" in m for m in messages)
    assert any("RENDER_SVC_ZARR_ROOT_URI" in m for m in messages)
