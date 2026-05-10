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
    def test_returns_canonical_not_found(self, store):
        with pytest.raises(CanonicalNotFound):
            render_from_gcs(
                store=store, prefix=PREFIX,
                composition="p1", identifier="MISSING", as_of="2026-05-08",
                fmt="png", persist=False,
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
