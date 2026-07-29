"""Browser lifecycle in bulk_dd_render — the 2026-07-29 Chrome incident.

Two failures were in play:

1. kaleido >= 1.0 launches a fresh Chrome per ``fig.to_image()`` unless a
   persistent server is running, so a nightly run spawned hundreds.
2. Dagster terminating a run left the script (and its worker pool, and their
   browsers) reparented to launchd, still rendering.

These tests pin the contracts rather than the browser: no Chrome is launched
here. Kept out of ``test_bulk_dd_render_gates.py`` because that module imports
xarray, which the sdk test env does not install.
"""

from __future__ import annotations

import signal
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import bulk_dd_render as B  # noqa: E402


# ---------------------------------------------------------------------------
# Browser binary selection
# ---------------------------------------------------------------------------

def test_chrome_kwargs_empty_by_default(monkeypatch):
    """Unset env → kaleido picks its own browser (behaviour unchanged)."""
    monkeypatch.delenv("RISKMODELS_CHROME_BIN", raising=False)
    assert B._chrome_kwargs() == {}


def test_chrome_kwargs_passes_configured_binary(monkeypatch):
    """chrome-headless-shell never registers with the macOS Dock."""
    monkeypatch.setenv("RISKMODELS_CHROME_BIN", "/opt/chrome-headless-shell")
    assert B._chrome_kwargs() == {"path": "/opt/chrome-headless-shell"}


def test_chrome_kwargs_ignores_blank(monkeypatch):
    monkeypatch.setenv("RISKMODELS_CHROME_BIN", "   ")
    assert B._chrome_kwargs() == {}


# ---------------------------------------------------------------------------
# Worker initializer
# ---------------------------------------------------------------------------

class _FakeKaleido:
    """Stand-in for the kaleido module. ``has_server=False`` models 0.x."""

    def __init__(self, has_server=True, fail=False):
        self.started = self.stopped = 0
        self.kwargs = None
        self._fail = fail
        if has_server:
            self.start_sync_server = self._start
            self.stop_sync_server = self._stop

    def _start(self, **kw):
        if self._fail:
            raise RuntimeError("no browser here")
        self.started += 1
        self.kwargs = kw

    def _stop(self, **_kw):
        self.stopped += 1


def _install(monkeypatch, fake):
    monkeypatch.setitem(sys.modules, "kaleido", fake)


def test_initializer_starts_one_persistent_server(monkeypatch):
    fake = _FakeKaleido()
    _install(monkeypatch, fake)
    monkeypatch.setattr(B.atexit, "register", lambda *_a, **_k: None)
    B._init_render_worker()
    assert fake.started == 1, "one browser per worker, not per export"


def test_initializer_forwards_the_configured_binary(monkeypatch):
    fake = _FakeKaleido()
    _install(monkeypatch, fake)
    monkeypatch.setattr(B.atexit, "register", lambda *_a, **_k: None)
    monkeypatch.setenv("RISKMODELS_CHROME_BIN", "/opt/chrome-headless-shell")
    B._init_render_worker()
    assert fake.kwargs.get("path") == "/opt/chrome-headless-shell"


def test_initializer_tolerates_kaleido_0x(monkeypatch):
    """kaleido 0.x has no sync server and needs no fix — must not raise."""
    _install(monkeypatch, _FakeKaleido(has_server=False))
    B._init_render_worker()  # no exception


def test_initializer_survives_a_browser_that_will_not_start(monkeypatch):
    """Degrade to per-call browsers rather than killing the worker."""
    _install(monkeypatch, _FakeKaleido(fail=True))
    B._init_render_worker()  # no exception


def test_initializer_without_kaleido_installed(monkeypatch):
    monkeypatch.setitem(sys.modules, "kaleido", None)
    monkeypatch.setattr(
        B, "_chrome_kwargs", lambda: (_ for _ in ()).throw(AssertionError)
    )
    B._init_render_worker()  # returns before touching kwargs


def test_shutdown_is_idempotent(monkeypatch):
    fake = _FakeKaleido()
    _install(monkeypatch, fake)
    B._shutdown_render_worker()
    B._shutdown_render_worker()
    assert fake.stopped == 2  # safe to call twice; never raises


# ---------------------------------------------------------------------------
# SIGTERM teardown — the orphan class
# ---------------------------------------------------------------------------

class _FakeExecutor:
    def __init__(self):
        self.shutdown_calls = []

    def shutdown(self, wait=True, cancel_futures=False):
        self.shutdown_calls.append((wait, cancel_futures))


def test_sigterm_handler_is_installed():
    box: dict = {}
    B._install_sigterm_teardown(box)
    try:
        assert signal.getsignal(signal.SIGTERM) not in (
            signal.SIG_DFL,
            signal.SIG_IGN,
        )
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.signal(signal.SIGINT, signal.default_int_handler)


def test_sigterm_cancels_queued_work_and_stops_the_browser(monkeypatch):
    """The pool must be torn down, not left running under launchd."""
    fake = _FakeKaleido()
    _install(monkeypatch, fake)
    ex = _FakeExecutor()
    box = {"executor": ex}
    killed: list = []
    monkeypatch.setattr(B.os, "kill", lambda pid, sig: killed.append(sig))
    monkeypatch.setattr(B.signal, "signal", lambda *_a: None)

    B._install_sigterm_teardown(box)
    # Re-arm with the real signal module so we can fetch the handler back.
    monkeypatch.undo()
    _install(monkeypatch, fake)
    monkeypatch.setattr(B.os, "kill", lambda pid, sig: killed.append(sig))
    B._install_sigterm_teardown(box)
    handler = signal.getsignal(signal.SIGTERM)
    try:
        handler(signal.SIGTERM, None)
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.signal(signal.SIGINT, signal.default_int_handler)

    assert ex.shutdown_calls == [(False, True)], "queued renders must be cancelled"
    assert fake.stopped >= 1, "worker browser must be stopped"
    assert signal.SIGTERM in killed, "exit status must still read as signalled"


def test_sigterm_handler_without_an_open_pool(monkeypatch):
    """Signalled before the pool opens — must not raise."""
    fake = _FakeKaleido()
    _install(monkeypatch, fake)
    monkeypatch.setattr(B.os, "kill", lambda *_a: None)
    B._install_sigterm_teardown({})
    handler = signal.getsignal(signal.SIGTERM)
    try:
        handler(signal.SIGTERM, None)
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.signal(signal.SIGINT, signal.default_int_handler)


def test_pool_is_created_with_the_initializer():
    """Guard the wiring: a pool without it reverts to per-export browsers."""
    src = Path(B.__file__).read_text()
    assert "initializer=_init_render_worker" in src


# ---------------------------------------------------------------------------
# Orphan watchdog — covers the case SIGTERM cannot
# ---------------------------------------------------------------------------
# The Dagster helper launches us with start_new_session=True and kills our
# group in cleanup_process, but only on the graceful path. If the run worker
# dies abruptly its cleanup never runs, and the separate session excludes us
# from any group kill — so no signal ever arrives and only self-monitoring
# catches it. Verified end-to-end against a real SIGKILLed parent; these pin
# the arming rules.

def test_watchdog_arms_when_a_live_parent_exists(monkeypatch):
    started = {}
    monkeypatch.setattr(B.os, "getppid", lambda: 4242)
    monkeypatch.setattr(
        B.threading, "Thread",
        lambda **kw: type("T", (), {"start": lambda s: started.setdefault("k", kw)})(),
    )
    B._start_orphan_watchdog({})
    assert started["k"]["daemon"] is True, "must not block interpreter exit"
    assert started["k"]["name"] == "orphan-watchdog"


def test_watchdog_does_not_arm_when_already_detached(monkeypatch):
    """nohup / launchd runs start at PPID 1 and are detached on purpose."""
    monkeypatch.setattr(B.os, "getppid", lambda: 1)
    monkeypatch.setattr(
        B.threading, "Thread",
        lambda **kw: pytest.fail("watchdog must not arm for a detached run"),
    )
    assert B._start_orphan_watchdog({}) is None
