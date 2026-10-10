"""bulk_fund_f1_render: long-short refusal.

The guard itself lives in BWMACRO (``bwmacro.snapshots.funds._ls_guard``) and
is tested there on real funds. Here a stand-in module with VMNFX's real book
totals exercises the script's handling: status row, no render, stale PNG
removed, and no import failure when BWMACRO predates the guard.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bulk_fund_f1_render.py"


@pytest.fixture(scope="module")
def bfr():
    spec = importlib.util.spec_from_file_location("bulk_fund_f1_render_under_test", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Exc(RuntimeError):
    sheet_unavailable = True

    def __init__(self, shape, verdict):
        self.shape, self.verdict = shape, verdict

    def as_dict(self):
        return {"status": "unavailable_long_short", "message": "long-short fund: sheet not available",
                "rule": self.verdict.rule, "book": self.shape}


def _install_guard(monkeypatch, refuse: bool):
    verdict = types.SimpleNamespace(refuse=refuse, rule="R1" if refuse else None, reason="")
    # VMNFX at its 2026-06-30 N-PORT filing
    shape = {"long_mv": 578631587.8, "short_mv": -551804075.51, "nav": 597170714.63}
    mod = types.ModuleType("bwmacro.snapshots.funds._ls_guard")
    mod.LongShortSheetUnavailable = _Exc
    mod.check_f1_renderable = lambda fid: (shape, verdict)
    for name in ("bwmacro", "bwmacro.snapshots", "bwmacro.snapshots.funds"):
        monkeypatch.setitem(sys.modules, name, sys.modules.get(name) or types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "bwmacro.snapshots.funds._ls_guard", mod)


def test_refusal_row_and_stale_png_removed(bfr, monkeypatch, tmp_path):
    _install_guard(monkeypatch, refuse=True)
    stale = tmp_path / "BW-FUND-S000019457_f1.png"
    stale.write_bytes(b"old page")
    row = bfr._render_one("BW-FUND-S000019457", tmp_path, tmp_path, upload_gcs=False,
                          gcs_bucket="gs://unused", resume=True, force=False)
    assert row["status"] == bfr.UNAVAILABLE_STATUS
    assert row["message"] == "long-short fund: sheet not available"
    assert row["stale_png_removed"] is True and not stale.exists()


def test_no_refusal_returns_none(bfr, monkeypatch):
    _install_guard(monkeypatch, refuse=False)
    assert bfr._long_short_refusal("BW-FUND-S000009228") is None


def test_missing_guard_module_is_tolerated(bfr, monkeypatch):
    monkeypatch.setitem(sys.modules, "bwmacro.snapshots.funds._ls_guard", None)
    assert bfr._long_short_refusal("BW-FUND-S000019457") is None
