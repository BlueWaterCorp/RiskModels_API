"""scripts/build_exposure_month_end_panel.py never writes into the ERM3 publish layout (ERM3-75 increment 5).

The panel is an ERM3 build output (build_exposure_month_end_panel -> output_gate -> sync_to_gcs); a copy written
by this script into gs://rm_api_data/eodhd/ was clobbered by the next publish and, with release slots, would never
reach the slot the API reads. Run: python -m pytest scripts/tests (needs numpy, pandas, xarray).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "build_exposure_month_end_panel.py"
_spec = importlib.util.spec_from_file_location("build_exposure_month_end_panel", _SCRIPT)
panel = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(panel)


@pytest.mark.parametrize("out", [
    "gs://rm_api_data/eodhd/ds_exposure_month_end_SPY_uni_mc_3000.zarr",
    "gs://rm_api_data/eodhd/slots/a/ds_exposure_month_end_SPY_uni_mc_3000.zarr",
    "gs://rm_api_data/eodhd/slots/b/ds_exposure_month_end_SPY_uni_mc_3000.zarr",
    "gs://rm_api_data/eodhd",
    "gs://rm_api_data/eodhd/",
])
def test_publish_layout_is_refused(out, monkeypatch):
    monkeypatch.delenv("ZARR_GCS_PREFIX", raising=False)
    assert "ERM3 publish layout" in (panel.publish_layout_violation(out) or "")


@pytest.mark.parametrize("out", [
    "./ds_exposure_month_end_SPY_uni_mc_3000.zarr",
    "/tmp/panel.zarr",
    "gs://rm_api_data/scratch/panel.zarr",
    "gs://rm_api_data/eodhd_scratch/panel.zarr",     # a sibling prefix, not the layout
    "gs://other_bucket/eodhd/panel.zarr",
])
def test_other_outputs_are_allowed(out, monkeypatch):
    monkeypatch.delenv("ZARR_GCS_PREFIX", raising=False)
    assert panel.publish_layout_violation(out) is None


def test_zarr_gcs_prefix_adds_a_guard_and_never_removes_production(monkeypatch):
    monkeypatch.setenv("ZARR_GCS_PREFIX", "rm_api_data/staging_e75_inc5/eodhd")
    assert panel.publish_layout_violation("gs://rm_api_data/staging_e75_inc5/eodhd/slots/a/x.zarr")
    # production stays guarded even when ZARR_GCS_PREFIX points elsewhere
    assert panel.publish_layout_violation("gs://rm_api_data/eodhd/x.zarr")
    assert panel.publish_layout_violation("gs://rm_api_data/eodhd/slots/b/x.zarr")
    assert panel.publish_layout_violation("gs://rm_api_data/scratch/x.zarr") is None
    # an explicit base adds to the default too
    assert panel.publish_layout_violation("gs://rm_api_data/eodhd/x.zarr", publish_base="other/base")
    assert panel.publish_layout_violation("gs://other/base/x.zarr", publish_base="gs://other/base/")


def test_main_exits_before_reading_anything(monkeypatch, capsys):
    monkeypatch.delenv("ZARR_GCS_PREFIX", raising=False)
    monkeypatch.setattr(sys, "argv", ["x", "--out", "gs://rm_api_data/eodhd/ds_exposure_month_end_SPY_uni_mc_3000.zarr"])
    monkeypatch.setattr(panel.xr, "open_zarr", lambda *a, **k: pytest.fail("opened a store"))
    assert panel.main() == 2
    assert "refusing to write" in capsys.readouterr().err
