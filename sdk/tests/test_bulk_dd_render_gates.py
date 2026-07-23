"""Unit tests for bulk_dd_render's skip-gates (H.118) + atomic outputs (H.119).

Covers the booked fixes:
- NaN sentinel: a NaN↔0.0 transition must change the per-ticker digest.
- Bool data_vars must participate in the digest (``np.issubdtype(bool,
  np.number)`` is False, so a numeric-only filter silently dropped them).
- Peer-cohort digest: a repair to a same-subsector peer must change the
  target's fingerprint; a repair in an unrelated cohort must NOT (no
  degradation to a global digest).
- Atomic outputs: a failed render leaves neither fresh finals nor .tmp litter.
- ``uploaded_partial`` is never recorded as fingerprint-current.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bulk_dd_render.py"


@pytest.fixture(scope="module")
def bdr():
    spec = importlib.util.spec_from_file_location("bulk_dd_render_under_test", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Fingerprint digests (H.118)
# ---------------------------------------------------------------------------

def _write_store(
    root: Path,
    name: str = "ds_test.zarr",
    *,
    values: np.ndarray | None = None,
    bool_values: np.ndarray | None = None,
    tickers: tuple[str, ...] = ("AAA", "BBB"),
    n_teo: int = 6,
) -> None:
    n_sym = len(tickers)
    if values is None:
        values = np.arange(n_teo * n_sym, dtype=np.float32).reshape(n_teo, n_sym)
    data_vars = {"px": (("teo", "symbol"), np.asarray(values, dtype=np.float32))}
    if bool_values is not None:
        data_vars["flag"] = (("teo", "symbol"), np.asarray(bool_values, dtype=bool))
    ds = xr.Dataset(
        data_vars,
        coords={
            "teo": np.arange(n_teo, dtype=np.int64),
            "symbol": [f"S{i}" for i in range(n_sym)],
            "ticker": ("symbol", list(tickers)),
        },
    )
    root.mkdir(parents=True, exist_ok=True)
    ds.to_zarr(root / name, consolidated=True)


def test_identical_inputs_give_identical_digests(bdr, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    _write_store(a)
    _write_store(b)
    fa = bdr.symbol_fingerprints(a, ["AAA", "BBB"])
    fb = bdr.symbol_fingerprints(b, ["AAA", "BBB"])
    assert fa and fa == fb


def test_nan_sentinel_distinguishes_nan_from_zero(bdr, tmp_path):
    vals_zero = np.zeros((6, 2), dtype=np.float32)
    vals_nan = vals_zero.copy()
    vals_nan[3, 0] = np.nan
    a, b = tmp_path / "a", tmp_path / "b"
    _write_store(a, values=vals_zero)
    _write_store(b, values=vals_nan)
    fa = bdr.symbol_fingerprints(a, ["AAA", "BBB"])
    fb = bdr.symbol_fingerprints(b, ["AAA", "BBB"])
    assert fa and fb
    assert fa["AAA"] != fb["AAA"], "NaN vs 0.0 must change the digest"
    assert fa["BBB"] == fb["BBB"], "untouched ticker must keep its digest"


def test_bool_var_changes_digest(bdr, tmp_path):
    flags_a = np.zeros((6, 2), dtype=bool)
    flags_b = flags_a.copy()
    flags_b[2, 0] = True
    a, b = tmp_path / "a", tmp_path / "b"
    _write_store(a, bool_values=flags_a)
    _write_store(b, bool_values=flags_b)
    fa = bdr.symbol_fingerprints(a, ["AAA", "BBB"])
    fb = bdr.symbol_fingerprints(b, ["AAA", "BBB"])
    assert fa and fb
    assert fa["AAA"] != fb["AAA"], "bool data_vars must participate in the digest"
    assert fa["BBB"] == fb["BBB"]


def _write_daily(root: Path, mc_overrides: dict[str, float] | None = None) -> None:
    """Minimal ds_daily.zarr: two 4-name subsectors (fs 10 and fs 20)."""
    tickers = ("AAA", "BBB", "GGG", "HHH", "CCC", "DDD", "EEE", "FFF")
    fs = np.array([10, 10, 10, 10, 20, 20, 20, 20], dtype=np.float32)
    bw = np.array([1, 1, 1, 1, 2, 2, 2, 2], dtype=np.float32)
    mc = np.array([800, 700, 600, 500, 400, 300, 200, 100], dtype=np.float32)
    for t, v in (mc_overrides or {}).items():
        mc[tickers.index(t)] = v
    n_teo, n_sym = 4, len(tickers)
    ds = xr.Dataset(
        {
            "fs_industry_code": (("teo", "symbol"), np.tile(fs, (n_teo, 1))),
            "bw_sector_code": (("teo", "symbol"), np.tile(bw, (n_teo, 1))),
            "market_cap": (("teo", "symbol"), np.tile(mc, (n_teo, 1))),
        },
        coords={
            "teo": np.arange(n_teo, dtype=np.int64),
            "symbol": [f"S{i}" for i in range(n_sym)],
            "ticker": ("symbol", list(tickers)),
        },
    )
    root.mkdir(parents=True, exist_ok=True)
    ds.to_zarr(root / "ds_daily.zarr", consolidated=True)


def test_peer_repair_invalidates_cohort_but_not_others(bdr, tmp_path):
    base, peer_chg, other_chg = tmp_path / "base", tmp_path / "peer", tmp_path / "other"
    _write_daily(base)
    _write_daily(peer_chg, {"BBB": 999.0})   # AAA's cohort-mate (fs 10)
    _write_daily(other_chg, {"CCC": 999.0})  # unrelated cohort (fs 20)
    want = ["AAA", "DDD"]
    f_base = bdr.symbol_fingerprints(base, want)
    f_peer = bdr.symbol_fingerprints(peer_chg, want)
    f_other = bdr.symbol_fingerprints(other_chg, want)
    assert f_base and f_peer and f_other
    # A repair to peer BBB must re-render AAA even though AAA's own rows are identical.
    assert f_base["AAA"] != f_peer["AAA"]
    # ...but must NOT degrade to a global digest: fs-20 names are untouched.
    assert f_base["DDD"] == f_peer["DDD"]
    # And a repair in the other cohort flips DDD, not AAA.
    assert f_base["AAA"] == f_other["AAA"]
    assert f_base["DDD"] != f_other["DDD"]


# ---------------------------------------------------------------------------
# Atomic outputs (H.119)
# ---------------------------------------------------------------------------

def _patch_render_stack(monkeypatch, *, pdf_fails: bool):
    import riskmodels.snapshots.canonical as canonical
    import riskmodels.snapshots.reference_renderer as reference_renderer
    import riskmodels.snapshots.zarr_context as zarr_context
    import riskmodels.snapshots.zarr_peer_analytics as zarr_peer_analytics

    monkeypatch.setattr(zarr_context, "build_p1_from_zarr", lambda t, z: object())
    monkeypatch.setattr(
        zarr_peer_analytics, "build_peer_comparison_from_zarr", lambda t, z: None
    )
    monkeypatch.setattr(canonical, "from_components", lambda p1, **kw: object())

    def _fake_png(snap, path):
        Path(path).write_bytes(b"PNGDATA")

    def _fake_pdf(snap, path):
        if pdf_fails:
            raise RuntimeError("boom mid-pdf")
        Path(path).write_bytes(b"PDFDATA")

    monkeypatch.setattr(reference_renderer, "render_canonical_to_png", _fake_png)
    monkeypatch.setattr(reference_renderer, "render_canonical_to_pdf", _fake_pdf)


def test_render_error_leaves_no_fresh_outputs(bdr, tmp_path, monkeypatch):
    _patch_render_stack(monkeypatch, pdf_fails=True)
    row = bdr._render_one(
        "AAPL", tmp_path, tmp_path,
        upload_gcs=False, gcs_bucket="gs://x", resume=False, timeout_s=0,
    )
    assert row["status"] == "error"
    tdir = tmp_path / "AAPL"
    # PNG succeeded but PDF failed: neither final may exist (the resume gate
    # would otherwise pin a fresh-mtime partial artifact forever) and the temp
    # litter must be gone.
    assert not (tdir / "AAPL_DD_latest.png").exists()
    assert not (tdir / "AAPL_DD_latest.pdf").exists()
    assert not list(tdir.glob("*.tmp"))


def test_render_success_promotes_both_outputs_atomically(bdr, tmp_path, monkeypatch):
    _patch_render_stack(monkeypatch, pdf_fails=False)
    row = bdr._render_one(
        "AAPL", tmp_path, tmp_path,
        upload_gcs=False, gcs_bucket="gs://x", resume=False, timeout_s=0,
    )
    assert row["status"] == "ok"
    tdir = tmp_path / "AAPL"
    assert (tdir / "AAPL_DD_latest.png").read_bytes() == b"PNGDATA"
    assert (tdir / "AAPL_DD_latest.pdf").read_bytes() == b"PDFDATA"
    assert not list(tdir.glob("*.tmp"))


# ---------------------------------------------------------------------------
# Fingerprint recording (H.119)
# ---------------------------------------------------------------------------

def test_uploaded_partial_is_not_fingerprint_recorded(bdr):
    assert "ok" in bdr._FINGERPRINT_RECORD_STATUSES
    assert "uploaded_partial" not in bdr._FINGERPRINT_RECORD_STATUSES, (
        "recording a failed per-ticker upload as fingerprint-current means the "
        "upload is never retried"
    )
