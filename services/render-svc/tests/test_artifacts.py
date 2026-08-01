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
    _adapter_for,
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

    def test_salt_changes_the_digest(self, monkeypatch):
        """The salt is what makes the subject id opaque.

        Without it the digest is reproducible by anyone holding the same
        positions, so the id could not be treated as an opaque handle.
        """
        positions = [{"ticker": "AAPL", "weight": 0.5}]
        monkeypatch.delenv("RENDER_SVC_SUBJECT_SALT", raising=False)
        unsalted = _payload_hash(positions)
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "s3cr3t")
        assert _payload_hash(positions) != unsalted

    def test_salt_preserves_dedup(self, monkeypatch):
        """Render-once still holds: one portfolio, one cache key, any caller."""
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "s3cr3t")
        a = [{"ticker": "NVDA", "weight": 0.2}, {"weight": 0.1, "ticker": "AAPL"}]
        b = [{"weight": 0.2, "ticker": "NVDA"}, {"ticker": "AAPL", "weight": 0.1}]
        assert _payload_hash(a) == _payload_hash(b)

    def test_distinct_salts_give_distinct_digests(self, monkeypatch):
        positions = [{"ticker": "AAPL", "weight": 0.5}]
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "one")
        first = _payload_hash(positions)
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "two")
        assert _payload_hash(positions) != first

    def test_salt_separator_blocks_boundary_collisions(self, monkeypatch):
        """`salt + canonical` alone would let two (salt, payload) pairs collide.

        The NUL separator makes the concatenation unambiguous.
        """
        positions = [{"ticker": "A", "weight": 1.0}]
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "ab")
        with_ab = _payload_hash(positions)
        monkeypatch.setenv("RENDER_SVC_SUBJECT_SALT", "a")
        assert _payload_hash(positions) != with_ab


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

        data, mime, gcs_path, resolved_as_of, _, _ = render_artifact(
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
        _, _, _, _, cache_control, _ = render_artifact(
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


class TestFilerSubjectIdSpellings:
    """One filer identity, two production spellings.

    Verified against ``gs://rm_api_data/snapshots/artifacts`` on 2026-08-01:
    ``entity_header@v1`` and ``top_holdings_erm_stacked@v1`` store CIK 1067983
    under the bare form, while ``nav_composition_dual@v1`` stores the same
    filer under the CIK-infix form. Both spellings must reach the bytes; the
    corpus is not going to be rewritten to one convention.
    """

    BARE = "BW-FILER-0001067983"
    CIK = "BW-FILER-CIK0001067983"

    def _write(self, store, subject_id, slug="top_holdings_erm_stacked"):
        path = f"snapshots/artifacts/{slug}@v1/{subject_id}/2026-03-31.json"
        store.write(path, b'{"pre_rendered":true}', content_type="application/json")
        return path

    def test_both_spellings_return_identical_bytes_when_stored_bare(self, store):
        """Artifact stored under the declared canonical spelling."""
        path = self._write(store, self.BARE)

        results = [
            render_artifact(
                _req(subject_id=sid, as_of="2026-03-31"),
                store=store, prefix=PREFIX, persist=False,
            )
            for sid in (self.BARE, self.CIK)
        ]

        assert results[0][0] == results[1][0], "same filer must yield same bytes"
        # Both land on the one object that exists, so the path and the
        # receipt derived from it agree too.
        assert results[0][2] == results[1][2] == path
        assert results[0][5] == results[1][5]

    def test_both_spellings_return_identical_bytes_when_stored_cik(self, store):
        """The nav_composition_dual case — stored under the deviation."""
        path = self._write(store, self.CIK, slug="nav_composition_dual")

        results = [
            render_artifact(
                _req(slug="nav_composition_dual", subject_id=sid, as_of="2026-03-31"),
                store=store, prefix=PREFIX, persist=False,
            )
            for sid in (self.BARE, self.CIK)
        ]

        assert results[0][0] == results[1][0]
        assert results[0][2] == results[1][2] == path

    def test_canonical_spelling_wins_when_both_exist(self, store):
        """Probe order is deterministic, so a duplicated artifact resolves the
        same way every time rather than depending on store iteration."""
        canonical_path = self._write(store, self.BARE)
        self._write(store, self.CIK)

        _, _, gcs_path, _, _, _ = render_artifact(
            _req(subject_id=self.CIK, as_of="2026-03-31"),
            store=store, prefix=PREFIX, persist=False,
        )
        assert gcs_path == canonical_path


class TestFilerErrorNamesTheRealCause:
    """A wrong id must not read as an unimplemented slug.

    This is the defect that cost the most time: every miss returned 501 with
    the GCS path render-svc wanted, which is indistinguishable from a slug
    that was never built, so filer coverage looked broken when the id
    convention was simply wrong.
    """

    BARE = "BW-FILER-0001067983"
    OTHER = "BW-FILER-0000320193"

    def test_wrong_as_of_is_404_and_lists_what_exists(self, store):
        from fastapi import HTTPException

        store.write(
            f"snapshots/artifacts/top_holdings_erm_stacked@v1/{self.BARE}/2026-03-31.json",
            b"{}", content_type="application/json",
        )
        store.write(
            f"snapshots/artifacts/top_holdings_erm_stacked@v1/{self.BARE}/2025-12-31.json",
            b"{}", content_type="application/json",
        )

        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id=self.BARE, as_of="2026-06-30"),
                store=store, prefix=PREFIX,
            )

        assert exc.value.status_code == 404, "wrong date is not 'not implemented'"
        msg = str(exc.value.detail)
        assert "2025-12-31" in msg and "2026-03-31" in msg, "must name valid dates"

    def test_available_dates_are_found_through_either_spelling(self, store):
        """The caller asking with the CIK infix still learns the real dates."""
        from fastapi import HTTPException

        store.write(
            f"snapshots/artifacts/top_holdings_erm_stacked@v1/{self.BARE}/2026-03-31.json",
            b"{}", content_type="application/json",
        )
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="BW-FILER-CIK0001067983", as_of="2026-06-30"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 404
        assert "2026-03-31" in str(exc.value.detail)

    def test_unknown_subject_is_404_naming_the_id_not_501(self, store):
        """The slug is populated for someone else, so the id is the problem."""
        from fastapi import HTTPException

        store.write(
            f"snapshots/artifacts/top_holdings_erm_stacked@v1/{self.OTHER}/2026-03-31.json",
            b"{}", content_type="application/json",
        )

        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id="BW-FILER-9999999999", as_of="2026-03-31"),
                store=store, prefix=PREFIX,
            )

        assert exc.value.status_code == 404, "an unknown id is not 501"
        msg = str(exc.value.detail)
        assert "BW-FILER-9999999999" in msg, "the error must name the id"
        assert "BW-FILER-CIK9999999999" in msg, "and the spellings it tried"

    def test_slug_never_built_still_returns_501(self, store):
        """The one condition 501 genuinely describes is preserved."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            render_artifact(
                _req(subject_id=self.BARE, as_of="2026-03-31"),
                store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 501
        assert "not pre-rendered for any" in str(exc.value.detail)


class TestAvailableAsOfDiscovery:
    """filer_13f rejects as_of='latest', so the valid dates must be listable."""

    BARE = "BW-FILER-0001067983"
    CIK = "BW-FILER-CIK0001067983"

    def test_merges_both_spellings(self, store):
        from render_svc.artifacts import available_as_of

        store.write(
            f"snapshots/artifacts/entity_header@v1/{self.BARE}/2025-12-31.json",
            b"{}", content_type="application/json",
        )
        store.write(
            f"snapshots/artifacts/entity_header@v1/{self.CIK}/2026-04-30.json",
            b"{}", content_type="application/json",
        )

        assert available_as_of(store, PREFIX, "entity_header", "v1", self.BARE) == [
            "2025-12-31", "2026-04-30",
        ]

    def test_dedupes_formats_and_params_to_distinct_dates(self, store):
        from render_svc.artifacts import available_as_of

        for leaf in ("2026-03-31.json", "2026-03-31.png", "2026-03-31.top_n-5.json"):
            store.write(
                f"snapshots/artifacts/top_holdings_erm_stacked@v1/{self.BARE}/{leaf}",
                b"{}", content_type="application/json",
            )

        assert available_as_of(
            store, PREFIX, "top_holdings_erm_stacked", "v1", self.BARE
        ) == ["2026-03-31"]

    def test_empty_for_unknown_subject(self, store):
        from render_svc.artifacts import available_as_of

        assert available_as_of(
            store, PREFIX, "entity_header", "v1", "BW-FILER-9999999999"
        ) == []

    def test_endpoint_reports_dates_and_the_spellings_it_searched(self, store):
        from dataclasses import replace

        from fastapi.testclient import TestClient

        from render_svc.app import _make_app
        from render_svc.settings import load_from_env

        store.write(
            f"snapshots/artifacts/entity_header@v1/{self.BARE}/2025-12-31.json",
            b"{}", content_type="application/json",
        )
        store.write(
            f"snapshots/artifacts/entity_header@v1/{self.CIK}/2026-04-30.json",
            b"{}", content_type="application/json",
        )
        settings = replace(load_from_env(), prefix=PREFIX, persist_renders=False)
        client = TestClient(_make_app(settings, store))

        body = client.get(
            "/artifacts/as-of",
            params={"slug": "entity_header", "subject_id": self.CIK},
        ).json()

        assert body["as_of"] == ["2025-12-31", "2026-04-30"]
        assert body["canonical_subject_id"] == self.BARE
        # The caller can see WHICH spellings were searched, so an empty result
        # is interpretable rather than just absent.
        assert body["subject_id_spellings_searched"] == [self.BARE, self.CIK]


# ── _adapter_for routing — verifies filer_13f dispatches by slug ──────────


class TestFilerAdapterRouting:
    """Direct tests on `_adapter_for` for the filer_13f subject_kind.

    Verifies the slug → adapter map without going through the full
    cache-miss path (which raises 501 before the adapter is invoked).
    Touches BWMACRO via the same fake-adapters stub used by other tests.
    """

    def test_top_holdings_routes_to_holdings_from_filer(self, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="top_holdings_erm_stacked",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        # Add the filer adapter to the fake adapters module.
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.holdings_from_filer_data = lambda fd, top_n=12: list(
            getattr(fd, "holdings", [])
        )[:top_n]
        fn = _adapter_for("top_holdings_erm_stacked", "filer_13f")
        assert callable(fn)

    def test_cumulative_return_strip_routes_to_filer_returns(self, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="cumulative_return_strip",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.cumulative_return_series_from_filer_data = lambda fd: fd
        fn = _adapter_for("cumulative_return_strip", "filer_13f")
        assert fn is adapters_mod.cumulative_return_series_from_filer_data

    def test_entity_header_routes_to_filer_header(self, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="entity_header",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.entity_header_from_filer_data = lambda fd: fd
        fn = _adapter_for("entity_header", "filer_13f")
        assert fn is adapters_mod.entity_header_from_filer_data

    def test_return_composition_bars_routes_to_filer_waterfall(self, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="return_composition_bars",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.attribution_waterfall_from_filer_data = lambda fd: fd
        fn = _adapter_for("return_composition_bars", "filer_13f")
        assert fn is adapters_mod.attribution_waterfall_from_filer_data

    def test_active_risk_composition_routes_to_filer_arc(self, monkeypatch):
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="active_risk_composition",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.active_risk_composition_from_filer_data = lambda fd: fd
        fn = _adapter_for("active_risk_composition", "filer_13f")
        assert fn is adapters_mod.active_risk_composition_from_filer_data

    def test_risk_summary_panel_routes_to_filer_pass_through(self, monkeypatch):
        """Phase 2 close-out: risk_summary_panel is the 6th and last
        widened artifact. Adapter is a pass-through (the artifact's
        render_data dispatches on FundData vs FilerData internally)."""
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="risk_summary_panel",
            version="v1",
            applicable=("fund", "filer_13f"),
        )
        adapters_mod = sys.modules["bwmacro.snapshots.artifacts.adapters"]
        adapters_mod.risk_summary_panel_from_filer_data = lambda fd: fd
        fn = _adapter_for("risk_summary_panel", "filer_13f")
        assert fn is adapters_mod.risk_summary_panel_from_filer_data

    def test_unwidened_slug_returns_501(self, monkeypatch):
        """All Phase 2 slugs are widened — this test exercises the 501
        path with a hypothetical un-widened slug. Use a stub slug that's
        registered as fund-only to assert the helpful error message."""
        _install_fake_bwmacro_artifact(
            monkeypatch,
            slug="not_yet_widened_slug",
            version="v1",
            applicable=("fund",),
        )
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _adapter_for("not_yet_widened_slug", "filer_13f")
        assert exc.value.status_code == 501
        assert "BWMACRO adapters.py" in str(exc.value.detail)


class TestDdPanelPrerendered:
    """Institutional DD figure units (dd_* stock slugs) — Tier-1 batch
    pre-rendered by ``bulk_dd_render --panels``; render-svc has no DDData
    loader, so cache-hit serves and cache-miss returns the actionable 501
    (full-page pointer + service@riskmodels.app request path)."""

    def _dd_req(self, **overrides):
        base = dict(
            slug="dd_peer_dna",
            version="v1",
            subject_id="BW-STOCK-NVDA",
            as_of="latest",
            format="png",
        )
        base.update(overrides)
        return ArtifactRenderRequest(**base)

    def test_latest_alias_cache_hit(self, store):
        """`as_of=latest` reads the batch-written latest.png alias key —
        no stock decompose loader call, no bwmacro import."""
        path = _artifact_gcs_path(
            PREFIX, "dd_peer_dna", "v1", "BW-STOCK-NVDA", "latest", "png"
        )
        store.write(path, b"\x89PNG-dd-panel", content_type="image/png")
        raw, mime, gcs_path, resolved_as_of, cache_control, _rid = render_artifact(
            self._dd_req(), store=store, prefix=PREFIX,
        )
        assert raw == b"\x89PNG-dd-panel"
        assert mime == "image/png"
        assert gcs_path == path
        assert resolved_as_of == "latest"
        assert "max-age=3600" in cache_control

    def test_explicit_as_of_cache_hit_immutable(self, store):
        path = _artifact_gcs_path(
            PREFIX, "dd_peer_dna", "v1", "BW-STOCK-NVDA", "2026-05-07", "png"
        )
        store.write(path, b"\x89PNG-vintage", content_type="image/png")
        raw, _mime, _p, resolved_as_of, cache_control, _rid = render_artifact(
            self._dd_req(as_of="2026-05-07"), store=store, prefix=PREFIX,
        )
        assert raw == b"\x89PNG-vintage"
        assert resolved_as_of == "2026-05-07"
        assert "immutable" in cache_control

    def test_cache_miss_returns_tier2_501(self, store):
        """Tier-2 contract: miss → 501 with the _full pointer and the
        service@riskmodels.app request path (the demand signal)."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            render_artifact(
                self._dd_req(subject_id="BW-STOCK-ZZZC"), store=store, prefix=PREFIX,
            )
        assert exc.value.status_code == 501
        detail = str(exc.value.detail)
        assert "zzzc_dd_latest.png" in detail
        assert "service@riskmodels.app" in detail

    def test_json_form_served_from_cache(self, store):
        path = _artifact_gcs_path(
            PREFIX, "dd_peer_dna", "v1", "BW-STOCK-NVDA", "latest", "json"
        )
        store.write(path, b'{"slug":"dd_peer_dna"}', content_type="application/json")
        raw, mime, *_rest = render_artifact(
            self._dd_req(format="json"), store=store, prefix=PREFIX,
        )
        assert json.loads(raw)["slug"] == "dd_peer_dna"
        assert mime == "application/json"


# ── Render params (Phase 3) ───────────────────────────────────────────────

from fastapi import HTTPException  # noqa: E402

from render_svc.artifacts import _params_key_fragment, _supplied_params  # noqa: E402


def _install_params_fake_artifact(
    monkeypatch, *, slug: str, applicable: tuple[str, ...],
    render_params: tuple[str, ...], capture: dict,
):
    """Fake artifact module that declares RENDER_PARAMS + records kwargs.

    Like ``_install_fake_bwmacro_artifact`` but the fake ``render_data`` /
    ``render_figure`` accept **kwargs (storing them in ``capture``) and the
    fake holdings adapter records the ``top_n`` it was called with.
    Overwrites any previously installed fake for the same slug.
    """
    pkg_root = "bwmacro.snapshots.artifacts"
    qualname = f"{pkg_root}.{slug}.v1"
    for p in ["bwmacro", "bwmacro.snapshots", pkg_root, f"{pkg_root}.{slug}"]:
        if p not in sys.modules:
            sys.modules[p] = types.ModuleType(p)

    mod = types.ModuleType(qualname)
    mod.ARTIFACT_SLUG = slug
    mod.ARTIFACT_VERSION = "v1"
    mod.APPLICABLE_SUBJECT_KINDS = applicable
    mod.RENDER_PARAMS = render_params

    def _render_data(data, **kwargs):
        capture["render_data_kwargs"] = kwargs
        return {"slug": slug, "kwargs": kwargs}

    class _FakeFigure:
        def to_image(self, *, format: str, scale: float = 1.0) -> bytes:
            return b"\x89PNG\r\n\x1a\nFAKE" if format == "png" else b"<svg>FAKE</svg>"

    def _render_figure(data, **kwargs):
        capture["render_figure_kwargs"] = kwargs
        return _FakeFigure()

    mod.render_data = _render_data
    mod.render_figure = _render_figure
    sys.modules[qualname] = mod

    adapters_qual = f"{pkg_root}.adapters"
    adapters_mod = sys.modules.get(adapters_qual) or types.ModuleType(adapters_qual)

    def _holdings(fd, top_n=12):
        capture["adapter_top_n"] = top_n
        return list(fd.holdings)[:top_n]

    adapters_mod.holdings_from_fund_data = _holdings
    if not hasattr(adapters_mod, "cumulative_return_series_from_fund_data"):
        adapters_mod.cumulative_return_series_from_fund_data = lambda fd: []
    sys.modules[adapters_qual] = adapters_mod
    sys.modules[pkg_root].adapters = adapters_mod  # type: ignore[attr-defined]
    return mod


class TestParamsValidation:
    def test_unknown_param_key_rejected(self):
        with pytest.raises(ValueError):
            ArtifactRenderRequest(
                slug="top_holdings_erm_stacked",
                version="v1",
                subject_id="BW-FUND-X",
                as_of="latest",
                params={"topk": 5},  # typo — extra=forbid
            )

    def test_top_n_bounds_enforced(self):
        with pytest.raises(ValueError):
            _req(params={"top_n": 0})
        with pytest.raises(ValueError):
            _req(params={"top_n": 51})

    def test_window_enum_enforced(self):
        # "5y" is in the enum (historical_risk_waterfall navigates that far
        # back); "7y" is not, and an unlisted rung must not reach a module
        # that would clamp it to the stored envelope and look honored.
        with pytest.raises(ValueError):
            _req(slug="cumulative_return_strip", params={"window": "7y"})

    def test_valid_params_round_trip(self):
        req = _req(params={"top_n": 5})
        assert req.params is not None
        assert req.params.top_n == 5


class TestSuppliedParams:
    def test_inapplicable_param_422(self, store):
        # window applies to cumulative_return_strip, not top_holdings.
        req = _req(params={"window": "3m"})
        with pytest.raises(HTTPException) as exc_info:
            render_artifact(req, store=store, prefix=PREFIX)
        assert exc_info.value.status_code == 422
        assert "not applicable" in exc_info.value.detail

    def test_paramless_slug_422(self, store):
        req = _req(slug="entity_header", params={"top_n": 5})
        with pytest.raises(HTTPException) as exc_info:
            render_artifact(req, store=store, prefix=PREFIX)
        assert exc_info.value.status_code == 422

    def test_no_params_passes_through_empty(self):
        assert _supplied_params(_req()) == {}


class TestParamsKeyFragment:
    def test_empty_params_legacy_key(self):
        assert _params_key_fragment({}) == ""

    def test_fragment_shapes(self):
        assert _params_key_fragment({"top_n": 5}) == ".top_n-5"
        assert _params_key_fragment({"window": "3m"}) == ".window-3m"

    def test_fragment_sorted_for_determinism(self):
        assert (
            _params_key_fragment({"window": "3m", "top_n": 5})
            == ".top_n-5+window-3m"
        )

    def test_path_includes_fragment(self):
        assert (
            _artifact_gcs_path(
                "snapshots", "top_holdings_erm_stacked", "v1",
                "BW-FUND-S000004563", "2025-11-30", "json", ".top_n-5",
            )
            == "snapshots/artifacts/top_holdings_erm_stacked@v1/"
               "BW-FUND-S000004563/2025-11-30.top_n-5.json"
        )


class TestRenderArtifactWithParams:
    def test_top_n_threads_to_adapter_and_module(self, store, monkeypatch):
        capture: dict = {}
        _install_params_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), render_params=("top_n",), capture=capture,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        data, mime, gcs_path, *_ = render_artifact(
            _req(params={"top_n": 5}), store=store, prefix=PREFIX,
        )
        assert capture["adapter_top_n"] == 5
        assert capture["render_data_kwargs"] == {"top_n": 5}
        assert gcs_path.endswith("/2025-11-30.top_n-5.json")
        assert json.loads(data)["kwargs"] == {"top_n": 5}

    def test_window_threads_to_module(self, store, monkeypatch):
        capture: dict = {}
        _install_params_fake_artifact(
            monkeypatch, slug="cumulative_return_strip",
            applicable=("fund",), render_params=("window",), capture=capture,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        _, _, gcs_path, *_ = render_artifact(
            _req(slug="cumulative_return_strip", params={"window": "3m"}),
            store=store, prefix=PREFIX,
        )
        assert capture["render_data_kwargs"] == {"window": "3m"}
        assert gcs_path.endswith("/2025-11-30.window-3m.json")

    def test_module_without_render_params_501(self, store, monkeypatch):
        capture: dict = {}
        _install_params_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), render_params=(), capture=capture,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        with pytest.raises(HTTPException) as exc_info:
            render_artifact(_req(params={"top_n": 5}), store=store, prefix=PREFIX)
        assert exc_info.value.status_code == 501
        assert "RENDER_PARAMS" in exc_info.value.detail

    def test_no_params_legacy_key_and_defaults(self, store, monkeypatch):
        capture: dict = {}
        _install_params_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), render_params=("top_n",), capture=capture,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        _, _, gcs_path, *_ = render_artifact(_req(), store=store, prefix=PREFIX)
        assert gcs_path.endswith("/2025-11-30.json")
        assert capture["render_data_kwargs"] == {}
        assert capture["adapter_top_n"] == 12

    def test_params_variants_persist_under_distinct_keys(self, store, monkeypatch):
        capture: dict = {}
        _install_params_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), render_params=("top_n",), capture=capture,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))
        _, _, path5, *_ = render_artifact(
            _req(params={"top_n": 5}), store=store, prefix=PREFIX,
        )
        _, _, path10, *_ = render_artifact(
            _req(params={"top_n": 10}), store=store, prefix=PREFIX,
        )
        _, _, path_default, *_ = render_artifact(
            _req(), store=store, prefix=PREFIX,
        )
        assert len({path5, path10, path_default}) == 3
        assert store.read(path5) is not None
        assert store.read(path10) is not None
        assert store.read(path_default) is not None


# ── format="figure" (Plotly figure spec) ──────────────────────────────────


class _FakePlotlyFigure:
    """Stand-in for a Plotly ``go.Figure`` — has ``.to_json()``."""

    def __init__(self, slug: str = "fake_slug"):
        self._slug = slug

    def to_json(self) -> str:
        return json.dumps(
            {
                "data": [{"type": "bar", "x": [1, 2], "y": [3, 4]}],
                "layout": {"title": {"text": self._slug}},
            }
        )

    def to_image(self, *, format: str, scale: float = 1.0) -> bytes:
        return b"\x89PNG\r\n\x1a\nFAKE" if format == "png" else b"<svg>FAKE</svg>"


class _FakeMplFigure:
    """Stand-in for a matplotlib ``Figure`` (or PIL ``Image``) — no
    ``.to_json()``, mirroring real slugs like ``variance_shares_bars`` /
    ``dd_peer_dna`` that are not Plotly-backed."""

    def to_image(self, *, format: str, scale: float = 1.0) -> bytes:
        return b"\x89PNG\r\n\x1a\nFAKE-MPL"


def _install_figure_fake_artifact(
    monkeypatch, *, slug: str, applicable: tuple[str, ...], plotly_backed: bool,
):
    """Fake artifact module whose ``render_figure`` returns a Plotly-like
    fake (``plotly_backed=True``) or a matplotlib/PIL-like fake with no
    ``.to_json()`` (``plotly_backed=False``)."""
    pkg_root = "bwmacro.snapshots.artifacts"
    qualname = f"{pkg_root}.{slug}.v1"
    for p in ["bwmacro", "bwmacro.snapshots", pkg_root, f"{pkg_root}.{slug}"]:
        if p not in sys.modules:
            sys.modules[p] = types.ModuleType(p)

    mod = types.ModuleType(qualname)
    mod.ARTIFACT_SLUG = slug
    mod.ARTIFACT_VERSION = "v1"
    mod.APPLICABLE_SUBJECT_KINDS = applicable
    mod.RENDER_PARAMS = ("top_n",)
    mod.render_data = lambda data, **kw: {"slug": slug}

    fig = _FakePlotlyFigure(slug) if plotly_backed else _FakeMplFigure()
    mod.render_figure = lambda data, **kw: fig
    sys.modules[qualname] = mod

    adapters_qual = f"{pkg_root}.adapters"
    adapters_mod = sys.modules.get(adapters_qual) or types.ModuleType(adapters_qual)
    if not hasattr(adapters_mod, "holdings_from_fund_data"):
        adapters_mod.holdings_from_fund_data = (
            lambda fd, top_n=12: list(fd.holdings)[:top_n]
        )
    sys.modules[adapters_qual] = adapters_mod
    sys.modules[pkg_root].adapters = adapters_mod  # type: ignore[attr-defined]
    return mod


class TestFigureFormat:
    """``format='figure'`` returns the Plotly figure spec (``fig.to_json()``)
    for Plotly-backed slugs, and is rejected for slugs whose
    ``render_figure`` returns a PIL/matplotlib object instead."""

    def test_figure_format_returns_parseable_plotly_json(self, store, monkeypatch):
        _install_figure_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), plotly_backed=True,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        data, mime, gcs_path, *_ = render_artifact(
            _req(format="figure"), store=store, prefix=PREFIX,
        )

        assert mime == "application/json"
        assert gcs_path.endswith(".figure")
        parsed = json.loads(data)
        assert "data" in parsed
        assert "layout" in parsed
        assert parsed["layout"]["title"]["text"] == "top_holdings_erm_stacked"

    def test_non_plotly_slug_rejects_figure_format(self, store, monkeypatch):
        """``render_figure`` returning a matplotlib/PIL object (no
        ``.to_json()``) must 400, not silently serve something bogus."""
        _install_figure_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), plotly_backed=False,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        with pytest.raises(HTTPException) as exc:
            render_artifact(_req(format="figure"), store=store, prefix=PREFIX)
        assert exc.value.status_code == 400
        detail = str(exc.value.detail)
        assert "figure" in detail
        assert "to_json" in detail

    def test_figure_format_still_writes_to_cache(self, store, monkeypatch):
        _install_figure_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), plotly_backed=True,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        _, _, gcs_path, *_ = render_artifact(
            _req(format="figure"), store=store, prefix=PREFIX,
        )
        assert gcs_path in store.objects


class TestFigureFormatCacheKey:
    """Render params (Phase 3) participate in the cache key regardless of
    output format; the no-params key must stay byte-identical to the
    pre-``figure`` shape so existing cached renders aren't orphaned."""

    def test_params_variants_produce_distinct_keys_under_figure_format(
        self, store, monkeypatch
    ):
        _install_figure_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), plotly_backed=True,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        _, _, path5, *_ = render_artifact(
            _req(format="figure", params={"top_n": 5}), store=store, prefix=PREFIX,
        )
        _, _, path10, *_ = render_artifact(
            _req(format="figure", params={"top_n": 10}), store=store, prefix=PREFIX,
        )
        _, _, path_default, *_ = render_artifact(
            _req(format="figure"), store=store, prefix=PREFIX,
        )

        assert len({path5, path10, path_default}) == 3
        assert store.read(path5) is not None
        assert store.read(path10) is not None
        assert store.read(path_default) is not None

    def test_no_params_key_unchanged_from_pre_figure_shape(self):
        """Legacy (no-params) key shape must be byte-identical to what it
        was before 'figure' landed — same extension-as-format convention,
        no stray fragment — so pre-existing cached json/png/svg renders
        keep hitting."""
        assert (
            _artifact_gcs_path(
                "snapshots", "top_holdings_erm_stacked", "v1",
                "BW-FUND-S000004563", "2025-11-30", "json",
            )
            == "snapshots/artifacts/top_holdings_erm_stacked@v1/"
               "BW-FUND-S000004563/2025-11-30.json"
        )
        assert _params_key_fragment({}) == ""

    def test_figure_format_key_distinct_from_json_key(self, store, monkeypatch):
        """Same slug/subject/as_of/params but different format → different
        GCS key (format is part of the cache key, same as png vs svg)."""
        _install_figure_fake_artifact(
            monkeypatch, slug="top_holdings_erm_stacked",
            applicable=("fund",), plotly_backed=True,
        )
        _patch_get_data_for_f1(monkeypatch, fd=FakeFundData(teo="2025-11-30"))

        _, _, json_path, *_ = render_artifact(
            _req(format="json"), store=store, prefix=PREFIX,
        )
        _, _, figure_path, *_ = render_artifact(
            _req(format="figure"), store=store, prefix=PREFIX,
        )
        assert json_path != figure_path




# ── _SLUG_PARAMS ↔ the real artifact modules ──────────────────────────────
#
# Everything above runs against fake modules, which is right for the
# wiring (that a declared param reaches render_data / render_figure and
# lands in the cache key) and useless for the agreement: the fake
# declares whatever the test asks it to. PANEL_PARAMETER_SURFACE_PROJECT
# §8b — "green suites over fakes prove the wiring, not the integration."
#
# The check runs in a subprocess for two reasons. The fakes above are
# installed by raw ``sys.modules`` assignment and are never removed, so an
# in-process import of ``bwmacro`` here would silently inspect a fake and
# pass. And ``bwmacro`` is not a render-svc dependency — it is mounted
# into the deployed image as ``bwmacro-src`` — so this must skip cleanly
# where it is absent rather than fail the local suite.

import subprocess  # noqa: E402

from render_svc.artifacts import _SLUG_PARAMS, ArtifactParams  # noqa: E402

_PROBE = """
import importlib, inspect, json, sys
slugs = json.loads(sys.argv[1])
out = {}
for slug in slugs:
    mod = importlib.import_module("bwmacro.snapshots.artifacts.%s.v1" % slug)
    entry = {"declared": sorted(getattr(mod, "RENDER_PARAMS", ()) or ())}
    for form in ("render_data", "render_figure"):
        fn = getattr(mod, form, None)
        if fn is None:
            entry[form] = None
            continue
        sig = inspect.signature(fn)
        if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            entry[form] = "**kwargs"
        else:
            entry[form] = sorted(sig.parameters)
    out[slug] = entry
print(json.dumps(out))
"""


@pytest.fixture(scope="module")
def real_module_params() -> dict:
    slugs = sorted(_SLUG_PARAMS)
    probe = subprocess.run(
        [sys.executable, "-c", _PROBE, json.dumps(slugs)],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        pytest.skip(
            "bwmacro artifact modules not importable in this environment "
            f"(bwmacro-src is mounted into the deployed image): "
            f"{probe.stderr.strip().splitlines()[-1] if probe.stderr.strip() else ''}"
        )
    return json.loads(probe.stdout)


class TestSlugParamsMatchModules:
    def test_module_declares_exactly_what_the_service_offers(self, real_module_params):
        """A param this service accepts but the module does not declare is a
        501 at request time; one the module declares but the service rejects
        is unreachable. Both stay invisible until a user tries the knob."""
        mismatched = {
            slug: {"module": entry["declared"], "service": sorted(_SLUG_PARAMS[slug])}
            for slug, entry in real_module_params.items()
            if set(entry["declared"]) != set(_SLUG_PARAMS[slug])
        }
        assert not mismatched, f"RENDER_PARAMS / _SLUG_PARAMS disagree: {mismatched}"

    def test_both_render_forms_accept_every_declared_param(self, real_module_params):
        """render-svc splats the same params into render_data and
        render_figure, so a param only one of them takes is a TypeError in
        production — on whichever format the caller happened to ask for."""
        missing = []
        for slug, entry in real_module_params.items():
            for form in ("render_data", "render_figure"):
                accepted = entry[form]
                if accepted is None or accepted == "**kwargs":
                    continue
                for param in sorted(_SLUG_PARAMS[slug]):
                    if param not in accepted:
                        missing.append(f"{slug}.{form}({param})")
        assert not missing, f"declared params not accepted: {missing}"

    def test_every_offered_param_is_an_artifact_params_field(self):
        """No subprocess needed — this one is entirely about this service."""
        fields = set(ArtifactParams.model_fields)
        unknown = {
            slug: sorted(set(params) - fields)
            for slug, params in _SLUG_PARAMS.items()
            if set(params) - fields
        }
        assert not unknown, f"slugs offering non-ArtifactParams keys: {unknown}"
