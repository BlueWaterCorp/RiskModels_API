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
    _payload_hash,
    _receipt_id,
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

        data, mime, gcs_path, resolved_as_of, cache_control, receipt_id = render_artifact(
            _req(), store=store, prefix=PREFIX,
        )

        assert mime == "application/json"
        body = json.loads(data)
        assert body["slug"] == "top_holdings_erm_stacked"
        assert resolved_as_of == "2025-11-30"
        assert gcs_path == "snapshots/artifacts/top_holdings_erm_stacked@v1/BW-FUND-S000004563/2025-11-30.json"
        assert cache_control == "public, max-age=3600"
        # Receipt-id is 8-hex-char stable hash of the GCS path.
        assert len(receipt_id) == 8
        assert all(c in "0123456789abcdef" for c in receipt_id)
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

        data, mime, gcs_path, _, _, _ = render_artifact(
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

        _, _, _, _, cache_control, _ = render_artifact(
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

        data, mime, gcs_path, resolved_as_of, _, _ = render_artifact(
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


# ── client_portfolio subject_payload path ─────────────────────────────────


def _patch_client_portfolio_adapter(monkeypatch):
    """Wire a fake `holdings_from_client_portfolio` onto the bwmacro stub
    package the test installs for `top_holdings_erm_stacked@v1`.

    The adapter is called by the endpoint's client_portfolio dispatch
    branch; without a fake it tries to import the real BWMACRO module.
    """
    _install_fake_bwmacro_artifact(
        monkeypatch,
        slug="top_holdings_erm_stacked",
        version="v1",
        applicable=("fund", "client_portfolio"),
        render_data_result={
            "slug": "top_holdings_erm_stacked",
            "rows": [{"label": "NVDA", "weight_pct": 20.0}],
        },
    )
    adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
    adapters_mod.holdings_from_client_portfolio = (
        lambda positions, top_n=12: list(positions)[:top_n]
    )


class TestReceiptId:
    """8-hex-char stable hash of the GCS path — for the LANDING masthead.

    The masthead's "#run_seq" token reads `run_seq` for snapshot-table-backed
    records and this `receipt_id` for artifact-registry-backed records.
    Both render identically in the UI.
    """

    def test_receipt_id_is_8_hex_chars(self):
        rid = _receipt_id("snapshots/artifacts/x@v1/BW-FUND-Y/2025-11-30.json")
        assert len(rid) == 8
        assert all(c in "0123456789abcdef" for c in rid)

    def test_receipt_id_is_deterministic(self):
        path = "snapshots/artifacts/x@v1/BW-FUND-Y/2025-11-30.json"
        assert _receipt_id(path) == _receipt_id(path)

    def test_receipt_id_changes_with_path(self):
        a = _receipt_id("snapshots/artifacts/x@v1/BW-FUND-Y/2025-11-30.json")
        b = _receipt_id("snapshots/artifacts/x@v1/BW-FUND-Z/2025-11-30.json")
        assert a != b

    def test_receipt_id_distinguishes_format(self):
        """Same artifact in JSON vs PNG → different receipt id (the GCS path
        differs by extension, so the masthead reads distinct records)."""
        json_rid = _receipt_id("snapshots/artifacts/x@v1/BW-FUND-Y/2025-11-30.json")
        png_rid = _receipt_id("snapshots/artifacts/x@v1/BW-FUND-Y/2025-11-30.png")
        assert json_rid != png_rid


class TestPayloadHash:
    def test_hash_is_stable_across_key_order(self):
        a = [{"ticker": "NVDA", "weight": 0.2}, {"weight": 0.1, "ticker": "AAPL"}]
        b = [{"weight": 0.2, "ticker": "NVDA"}, {"ticker": "AAPL", "weight": 0.1}]
        assert _payload_hash(a) == _payload_hash(b)

    def test_hash_changes_when_payload_changes(self):
        a = [{"ticker": "NVDA", "weight": 0.2}]
        b = [{"ticker": "NVDA", "weight": 0.3}]
        assert _payload_hash(a) != _payload_hash(b)

    def test_hash_is_16_chars(self):
        h = _payload_hash([{"ticker": "X", "weight": 0.5}])
        assert len(h) == 16
        # hex-only
        assert all(c in "0123456789abcdef" for c in h)


class TestClientPortfolioPath:
    def _payload(self):
        return {
            "positions": [
                {"ticker": "NVDA", "weight": 0.2,
                 "l3_mkt_er": 0.1, "l3_sec_er": 0.15,
                 "l3_sub_er": 0.05, "l3_res_er": 0.7},
                {"ticker": "AAPL", "weight": 0.1},
            ]
        }

    def test_happy_path_renders_and_writes(self, store, monkeypatch):
        _patch_client_portfolio_adapter(monkeypatch)
        req = _req(
            subject_id="BW-PORTFOLIO-",  # placeholder; server rewrites with hash
            subject_payload=self._payload(),
        )
        data, mime, gcs_path, resolved_as_of, cache_control, receipt_id = render_artifact(
            req, store=store, prefix=PREFIX,
        )

        assert mime == "application/json"
        body = json.loads(data)
        assert body["slug"] == "top_holdings_erm_stacked"
        # Receipt-id is the 8-hex-char hash of the gcs_path — proves the
        # masthead can read a stable record identifier without parsing the path.
        assert len(receipt_id) == 8
        assert all(c in "0123456789abcdef" for c in receipt_id)

        # GCS path uses BW-PORTFOLIO-<hash> + today's UTC date.
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        expected_hash = _payload_hash(self._payload()["positions"])
        expected_path = (
            f"snapshots/artifacts/top_holdings_erm_stacked@v1/"
            f"BW-PORTFOLIO-{expected_hash}/{today}.json"
        )
        assert gcs_path == expected_path
        assert resolved_as_of == today
        # `as_of=latest` cache-control is the short ttl for client_portfolio too.
        assert cache_control == "public, max-age=3600"
        # Persisted to the cache for subsequent identical pastes.
        assert gcs_path in store.objects

    def test_missing_subject_payload_returns_400(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="BW-PORTFOLIO-", subject_payload=None),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 400
        assert "subject_payload" in str(exc.value.detail)

    def test_empty_positions_returns_400(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(
                    subject_id="BW-PORTFOLIO-",
                    subject_payload={"positions": []},
                ),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 400
        assert "positions" in str(exc.value.detail)

    def test_non_list_positions_returns_400(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(
                    subject_id="BW-PORTFOLIO-",
                    subject_payload={"positions": "not-a-list"},
                ),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 400

    def test_explicit_as_of_uses_immutable_cache(self, store, monkeypatch):
        _patch_client_portfolio_adapter(monkeypatch)
        _, _, gcs_path, resolved_as_of, cache_control, _ = render_artifact(
            _req(
                subject_id="BW-PORTFOLIO-",
                subject_payload=self._payload(),
                as_of="2025-11-30",
            ),
            store=store, prefix=PREFIX,
        )
        assert resolved_as_of == "2025-11-30"
        assert "/2025-11-30.json" in gcs_path
        assert "immutable" in cache_control

    def test_same_payload_hits_cache(self, store, monkeypatch):
        """Two pastes of the same portfolio resolve to the same GCS key.

        First call live-renders + writes. Second call hits the cache.
        The fake adapter would return a different mutable object each
        invocation, so cache identity means we hit step 1, not the adapter.
        """
        _patch_client_portfolio_adapter(monkeypatch)
        req1 = _req(
            subject_id="BW-PORTFOLIO-",
            subject_payload=self._payload(),
        )
        data1, _, gcs_path1, _, _, _ = render_artifact(req1, store=store, prefix=PREFIX)

        # Swap the adapter to return something obviously different — proves
        # the second call comes from cache, not from a fresh render.
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.holdings_from_client_portfolio = lambda positions, top_n=12: []
        mod = sys.modules["bwmacro.snapshots.artifacts.top_holdings_erm_stacked.v1"]
        mod.render_data = lambda data: {"slug": "DIFFERENT", "rows": []}

        req2 = _req(
            subject_id="BW-PORTFOLIO-",
            subject_payload=self._payload(),  # identical payload
        )
        data2, _, gcs_path2, _, _, _ = render_artifact(req2, store=store, prefix=PREFIX)

        assert gcs_path1 == gcs_path2
        assert data1 == data2  # cached bytes, not the new fake's bytes
        assert b"DIFFERENT" not in data2


# ── filer_13f subject (Phase 2 — LANDING Berkshire preload) ───────────────


class TestFilerPath:
    """Filer subjects use the pre-render-to-GCS path; cache hits work
    end-to-end, cache misses raise 501 (no SDK loader inside render-svc).
    """

    BERKSHIRE = "BW-FILER-CIK0001067983"

    def test_cache_hit_returns_pre_rendered_bytes(self, store, monkeypatch):
        """The LANDING daily-refresh job pre-renders Berkshire artifacts
        into GCS; subsequent requests hit the cache and never touch the
        adapter chain."""
        cached = b'{"slug":"top_holdings_erm_stacked","pre_rendered":true}'
        path = (
            "snapshots/artifacts/top_holdings_erm_stacked@v1/"
            f"{self.BERKSHIRE}/2026-03-31.json"
        )
        store.write(path, cached, content_type="application/json")

        data, mime, gcs_path, resolved_as_of, _ = render_artifact(
            _req(subject_id=self.BERKSHIRE, as_of="2026-03-31"),
            store=store, prefix=PREFIX, persist=False,
        )

        assert data == cached
        assert mime == "application/json"
        assert gcs_path == path
        assert resolved_as_of == "2026-03-31"

    def test_cache_miss_returns_501_with_pre_render_guidance(self, store, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id=self.BERKSHIRE, as_of="2026-03-31"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 501
        msg = str(exc.value.detail)
        assert "filer_13f" in msg
        # Message tells the operator where to pre-render to.
        assert "Pre-render" in msg or "pre-render" in msg
        assert "daily refresh" in msg

    def test_latest_as_of_rejected_for_filer(self, store):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id=self.BERKSHIRE, as_of="latest"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 400
        assert "latest" in str(exc.value.detail)
        assert "filer_13f" in str(exc.value.detail)

    def test_cache_hit_uses_immutable_cache_for_explicit_date(self, store):
        cached = b'{"ok":true}'
        path = (
            "snapshots/artifacts/top_holdings_erm_stacked@v1/"
            f"{self.BERKSHIRE}/2026-03-31.json"
        )
        store.write(path, cached, content_type="application/json")
        _, _, _, _, cache_control = render_artifact(
            _req(subject_id=self.BERKSHIRE, as_of="2026-03-31"),
            store=store, prefix=PREFIX, persist=False,
        )
        assert "immutable" in cache_control

    def test_subject_id_prefix_routing_for_filer(self, store):
        """BW-FILER-* dispatches to filer_13f even when no cache + no payload."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="BW-FILER-CIK0000320193", as_of="2025-12-31"),
                store=store, prefix=PREFIX,
            )
        # 501 (filer cache miss), not 422 (wrong prefix).
        assert exc.value.status_code == 501
