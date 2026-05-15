"""Tests for the artifact registry endpoint (`POST /artifacts/render`).

Uses the in-memory FakeStore from conftest. Mocks `riskmodels.snapshots.
get_data_for_f1` + `bwmacro.snapshots.artifacts.adapters` so the test
suite doesn't need GCS, zarr stores, or the BWMACRO sibling clone.

Verifies:
  - Cache hit path returns bytes directly without touching the live render.
  - Cache miss path imports the artifact module, calls render_data /
    render_figure, writes back, and returns bytes.
  - Subject-kind validation (artifact's APPLICABLE_SUBJECT_KINDS).
  - Unknown slug → 404.
  - Arbitrary historical as_of → 501.
  - Latest-as_of resolves to the loader's reported `teo`.
  - Format MIME headers + Cache-Control vary correctly.
"""

from __future__ import annotations

import json
import sys
import types
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest

from render_svc.artifacts import (
    ArtifactRenderRequest,
    _artifact_gcs_path,
    _cache_control_for,
    render_artifact,
)


PREFIX = "snapshots"


# ── Fakes ─────────────────────────────────────────────────────────────────

@dataclass
class FakeFundData:
    """Mimics the SDK's FundData where `teo` is the resolved as_of."""

    teo: str = "2025-11-30"
    bw_fund_id: str = "BW-FUND-S000004563"
    holdings: list = field(default_factory=list)


def _install_fake_bwmacro_artifact(monkeypatch, *, slug: str, version: str,
                                    applicable: tuple[str, ...],
                                    render_data_result: dict | None = None,
                                    render_figure_result=None):
    """Install a fake `bwmacro.snapshots.artifacts.{slug}.{version}` module."""
    pkg_root = "bwmacro.snapshots.artifacts"
    qualname = f"{pkg_root}.{slug}.{version}"

    # Make the parent packages importable (empty namespace).
    for p in [
        "bwmacro",
        "bwmacro.snapshots",
        pkg_root,
        f"{pkg_root}.{slug}",
    ]:
        if p not in sys.modules:
            sys.modules[p] = types.ModuleType(p)

    mod = types.ModuleType(qualname)
    mod.ARTIFACT_SLUG = slug
    mod.ARTIFACT_VERSION = version
    mod.APPLICABLE_SUBJECT_KINDS = applicable
    mod.render_data = lambda data: render_data_result or {"ok": True, "n": len(getattr(data, "items", data) or [])}

    class _FakeFigure:
        def to_image(self, *, format: str, scale: float = 1.0) -> bytes:
            if format == "png":
                return b"\x89PNG\r\n\x1a\nFAKE"
            if format == "svg":
                return b"<svg>FAKE</svg>"
            raise ValueError(format)

    mod.render_figure = lambda data: render_figure_result or _FakeFigure()
    sys.modules[qualname] = mod

    # Also seed a fake adapters module the endpoint will import.
    adapters_qual = f"{pkg_root}.adapters"
    if adapters_qual not in sys.modules:
        adapters_mod = types.ModuleType(adapters_qual)
        adapters_mod.holdings_from_fund_data = lambda fd, top_n=12: list(fd.holdings)[:top_n]
        adapters_mod.cumulative_return_series_from_fund_data = lambda fd: []
        sys.modules[adapters_qual] = adapters_mod
        # Also expose the adapters under the package's attribute path so
        # `from bwmacro.snapshots.artifacts import adapters` works.
        sys.modules[pkg_root].adapters = adapters_mod  # type: ignore[attr-defined]
    return mod


def _patch_get_data_for_f1(monkeypatch, *, fd: FakeFundData):
    """Install a fake `riskmodels.snapshots.get_data_for_f1` returning `fd`."""
    fake_sdk_snapshots = types.ModuleType("riskmodels.snapshots.fake_stub_for_test")
    # Patch the import the endpoint does:
    #   from riskmodels.snapshots import get_data_for_f1
    import riskmodels.snapshots as rs
    monkeypatch.setattr(rs, "get_data_for_f1", lambda bw_fund_id, **kw: fd, raising=False)


# ── Helpers ───────────────────────────────────────────────────────────────


def _req(**overrides):
    base = dict(
        slug="top_holdings_erm_stacked",
        version="v1",
        subject_id="BW-FUND-S000004563",
        as_of="latest",
        format="json",
    )
    base.update(overrides)
    return ArtifactRenderRequest(**base)


# ── Unit tests on helpers ─────────────────────────────────────────────────


class TestPathBuilder:
    def test_path_shape(self):
        assert (
            _artifact_gcs_path("snapshots", "top_holdings_erm_stacked", "v1",
                               "BW-FUND-S000004563", "2025-11-30", "json")
            == "snapshots/artifacts/top_holdings_erm_stacked@v1/BW-FUND-S000004563/2025-11-30.json"
        )

    def test_path_strips_trailing_slash(self):
        assert (
            _artifact_gcs_path("snapshots/", "x", "v1", "y", "2025-01-01", "png")
            == "snapshots/artifacts/x@v1/y/2025-01-01.png"
        )


class TestCacheControl:
    def test_latest_short(self):
        assert _cache_control_for("latest") == "public, max-age=3600"

    def test_explicit_date_immutable(self):
        cc = _cache_control_for("2025-11-30")
        assert "immutable" in cc
        assert "max-age=31536000" in cc


# ── Request validation ────────────────────────────────────────────────────


class TestRequestValidation:
    def test_invalid_slug_rejected(self):
        with pytest.raises(ValueError):
            ArtifactRenderRequest(
                slug="Top-Holdings",  # bad: uppercase + hyphen
                version="v1",
                subject_id="BW-FUND-X",
                as_of="latest",
            )

    def test_invalid_version_rejected(self):
        with pytest.raises(ValueError):
            ArtifactRenderRequest(
                slug="top_holdings_erm_stacked",
                version="1",  # bad: missing 'v' prefix
                subject_id="BW-FUND-X",
                as_of="latest",
            )

    def test_invalid_as_of_rejected(self):
        with pytest.raises(ValueError):
            ArtifactRenderRequest(
                slug="x",
                version="v1",
                subject_id="BW-FUND-X",
                as_of="2025/11/30",  # bad separator
            )

    def test_unknown_format_rejected(self):
        with pytest.raises(ValueError):
            ArtifactRenderRequest(
                slug="x",
                version="v1",
                subject_id="BW-FUND-X",
                as_of="latest",
                format="pdf",  # not in Literal["json", "png", "svg"]
            )


# ── End-to-end render path ────────────────────────────────────────────────


class TestRenderArtifactCacheMiss:
    def test_json_render_fund_subject(self, store, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund",),
            render_data_result={"slug": "top_holdings_erm_stacked", "rows": []},
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        data, mime, gcs_path, resolved_as_of, cache_control = render_artifact(
            _req(), store=store, prefix=PREFIX,
        )

        assert mime == "application/json"
        body = json.loads(data)
        assert body["slug"] == "top_holdings_erm_stacked"
        assert resolved_as_of == "2025-11-30"
        assert gcs_path == "snapshots/artifacts/top_holdings_erm_stacked@v1/BW-FUND-S000004563/2025-11-30.json"
        assert cache_control == "public, max-age=3600"
        # Bytes written to cache for subsequent hits.
        assert gcs_path in store.objects

    def test_png_render_uses_figure_path(self, store, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund",),
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        data, mime, gcs_path, _, _ = render_artifact(
            _req(format="png"), store=store, prefix=PREFIX,
        )

        assert mime == "image/png"
        assert data.startswith(b"\x89PNG")
        assert gcs_path.endswith(".png")

    def test_explicit_as_of_matches_resolved_uses_immutable_cache(self, store, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund",),
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        _, _, _, _, cache_control = render_artifact(
            _req(as_of="2025-11-30"), store=store, prefix=PREFIX,
        )
        assert "immutable" in cache_control


class TestRenderArtifactCacheHit:
    def test_returns_cached_bytes_without_render(self, store, monkeypatch):
        # Don't install a fake module — cache hit should never need to
        # import it.
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        cached = b'{"cached":true}'
        path = "snapshots/artifacts/top_holdings_erm_stacked@v1/BW-FUND-S000004563/2025-11-30.json"
        store.write(path, cached, content_type="application/json")

        data, mime, gcs_path, resolved_as_of, _ = render_artifact(
            _req(), store=store, prefix=PREFIX, persist=False,
        )

        assert data == cached
        assert mime == "application/json"
        assert gcs_path == path
        assert resolved_as_of == "2025-11-30"


class TestRenderArtifactErrors:
    def test_unknown_subject_prefix_returns_422(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="FOO-BAR-1"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 422
        assert "subject_id prefix" in str(exc.value.detail)

    def test_etf_subject_returns_501(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="BW-ETF-IVV"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 501
        assert "subject_kind='etf'" in str(exc.value.detail)

    def test_specific_historical_as_of_returns_501(self, store, monkeypatch):
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(as_of="2024-12-31"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 501
        assert "Phase 2" in str(exc.value.detail)

    def test_subject_kind_not_in_applicable_returns_422(self, store, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("filer_13f",),  # excludes 'fund'
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(_req(), store=store, prefix=PREFIX)
        assert exc.value.status_code == 422
        assert "not applicable" in str(exc.value.detail)

    def test_unknown_slug_returns_404(self, store, monkeypatch):
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(slug="nonexistent_artifact"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 404
        assert "nonexistent_artifact@v1" in str(exc.value.detail)
