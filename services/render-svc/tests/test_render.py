"""End-to-end tests for the cache-hit render path.

Uses the in-memory FakeStore from conftest. No real GCS, no Cloud Run.
"""

from __future__ import annotations

import pytest

from render_svc.gcs import canonical_path
from render_svc.render import (
    CanonicalNotFound,
    GateFailure,
    render_from_gcs,
)


PREFIX = "snapshots"


def _seed(store, json_bytes, *, composition="p1", identifier="TEST", as_of="2026-05-08"):
    path = canonical_path(PREFIX, composition, identifier, as_of, "json")
    store.write(path, json_bytes, content_type="application/json")
    return path


class TestCacheHit:
    def test_json_passthrough(self, store, p1_canonical_json):
        _seed(store, p1_canonical_json)

        result = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="TEST", as_of="2026-05-08",
            fmt="json", persist=False,
        )

        assert result.data == p1_canonical_json
        assert result.content_type == "application/json"
        assert result.written_to_cache is False

    def test_png_render_writes_back(self, store, p1_canonical_json):
        _seed(store, p1_canonical_json)

        result = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="TEST", as_of="2026-05-08",
            fmt="png", persist=True,
        )

        assert result.content_type == "image/png"
        assert result.data[:8] == b"\x89PNG\r\n\x1a\n"
        assert result.written_to_cache is True
        assert canonical_path(PREFIX, "p1", "TEST", "2026-05-08", "png") in store.objects

    def test_png_deterministic_within_request(self, store, p1_canonical_json):
        """Same canonical → same rendered bytes on re-request (the cache anchor)."""
        _seed(store, p1_canonical_json)

        a = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="TEST", as_of="2026-05-08",
            fmt="png", persist=False,
        )
        b = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="TEST", as_of="2026-05-08",
            fmt="png", persist=False,
        )
        assert a.data == b.data

    def test_pdf_render(self, store, p1_canonical_json):
        _seed(store, p1_canonical_json)

        result = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="TEST", as_of="2026-05-08",
            fmt="pdf", persist=False,
        )

        assert result.content_type == "application/pdf"
        assert result.data[:5] == b"%PDF-"
        assert len(result.data) > 1000


class TestCacheMiss:
    def test_returns_canonical_not_found_when_live_disabled(self, store):
        with pytest.raises(CanonicalNotFound):
            render_from_gcs(
                store=store, prefix=PREFIX,
                composition="p1", identifier="MISSING", as_of="2026-05-08",
                fmt="png", persist=False,
                live_render=False,
            )

    def test_live_render_p1_writes_canonical_back(self, store):
        """Cache miss + live_render=True: compute → cache → render."""
        from riskmodels.snapshots import (
            AomProvenance, AttributionPoint, CanonicalStockSnapshot,
            CoreMetrics, DecompositionPoint, Identity, PerformanceAttribution,
            RiskDecomposition, TemporalContext,
        )
        from riskmodels.snapshots.canonical import (
            CANONICAL_ONTOLOGY_VERSION, CANONICAL_SCHEMA_VERSION,
        )

        fake_snap = CanonicalStockSnapshot(
            schema_version=CANONICAL_SCHEMA_VERSION,
            generated_utc="2026-05-09T16:00:00+00:00",
            identity=Identity(
                ticker="LIVE", company_name="Live Co", as_of="2026-05-08",
                sector_etf="XLK", subsector_etf="SMH", market_cap_usd=1e10,
            ),
            core_metrics=CoreMetrics(
                beta=1.0, vol_23d=0.2, residual_er=0.01,
                market_share=0.55, sector_share=0.20,
                subsector_share=0.10, residual_share=0.15,
            ),
            performance=PerformanceAttribution(
                window_label="1Y", window_start="2025-05-08", window_end="2026-05-08",
                series=[AttributionPoint("Market", 0.18, 0)],
            ),
            risk=RiskDecomposition(
                total_variance=0.04,
                components=[DecompositionPoint("Market", 1.0, 0)],
            ),
            aom=AomProvenance(
                composition="P1", subject_type="stock", subject_id="LIVE",
                as_of="2026-05-08",
                lenses=["return_attribution", "risk_decomposition", "exposure"],
                view="snapshot", observation_mode="knowledge",
                ontology_version=CANONICAL_ONTOLOGY_VERSION,
            ),
            temporal=TemporalContext(
                observation_mode="knowledge",
                report_date="2026-05-08",
                filing_date="2026-05-08",
            ),
        )

        def fake_compute_p1(*, ticker, as_of, generated_utc, zarr_root_uri):
            return fake_snap

        result = render_from_gcs(
            store=store, prefix=PREFIX,
            composition="p1", identifier="LIVE", as_of="2026-05-08",
            fmt="png", persist=True,
            live_render=True,
            compute_p1=fake_compute_p1,
        )

        assert result.content_type == "image/png"
        assert result.data[:8] == b"\x89PNG\r\n\x1a\n"
        assert result.written_to_cache is True
        # The canonical JSON should now be in the store at the canonical path
        assert canonical_path(PREFIX, "p1", "LIVE", "2026-05-08", "json") in store.objects
        # And the rendered PNG too
        assert canonical_path(PREFIX, "p1", "LIVE", "2026-05-08", "png") in store.objects

    def test_live_render_unavailable_raises_503_class(self, store):
        """When the compute path raises LiveRenderUnavailable, propagate."""
        from render_svc.render import LiveRenderUnavailable

        def failing_compute(**kwargs):
            raise LiveRenderUnavailable("zarr root unreachable in test env")

        with pytest.raises(LiveRenderUnavailable):
            render_from_gcs(
                store=store, prefix=PREFIX,
                composition="p1", identifier="MISSING", as_of="2026-05-08",
                fmt="png", persist=False,
                live_render=True,
                compute_p1=failing_compute,
            )


class TestGate:
    def test_failing_canonical_rejected(self, store, p1_canonical_json):
        """A canonical with mangled ontology_version fails the fast-subset gate."""
        import json
        raw = json.loads(p1_canonical_json)
        raw["ontology_version"] = "riskmodels-ontology/0.0"  # bogus
        bad_bytes = json.dumps(raw).encode()

        _seed(store, bad_bytes)

        with pytest.raises(GateFailure) as exc:
            render_from_gcs(
                store=store, prefix=PREFIX,
                composition="p1", identifier="TEST", as_of="2026-05-08",
                fmt="png", persist=False,
            )
        assert any("ontology_version" in f for f in exc.value.failures)


class TestPathResolution:
    def test_monthly_partition(self):
        assert canonical_path("snapshots", "p1", "NVDA", "2026-05-09", "pdf") == \
            "snapshots/p1/2026-05/NVDA.pdf"

    def test_lowercase_composition_required(self):
        # Composition normalized to lowercase before path resolution.
        with pytest.raises(ValueError):
            canonical_path("snapshots", "Z9", "X", "2026-01-01", "pdf")
