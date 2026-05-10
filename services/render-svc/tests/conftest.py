"""Shared fixtures: fake object store + a synthetic canonical snapshot."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import pytest

from render_svc.gcs import ObjectStore


@dataclass
class FakeStore(ObjectStore):
    """In-memory object store used by tests. Mirrors GcsObjectStore semantics."""

    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)

    def head(self, path: str) -> bool:
        return path in self.objects

    def read(self, path: str) -> bytes | None:
        entry = self.objects.get(path)
        return entry[0] if entry else None

    def write(self, path: str, data: bytes, *, content_type: str) -> None:
        self.objects[path] = (data, content_type)


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def p1_canonical_json() -> bytes:
    """Build a synthetic CanonicalStockSnapshot and return its JSON bytes."""
    from riskmodels.snapshots import (
        AomProvenance,
        AttributionPoint,
        CanonicalStockSnapshot,
        CoreMetrics,
        DecompositionPoint,
        Identity,
        PerformanceAttribution,
        RiskDecomposition,
        TemporalContext,
    )
    from riskmodels.snapshots.canonical import (
        CANONICAL_ONTOLOGY_VERSION,
        CANONICAL_SCHEMA_VERSION,
    )

    snap = CanonicalStockSnapshot(
        schema_version=CANONICAL_SCHEMA_VERSION,
        generated_utc="2026-05-09T16:00:00+00:00",
        identity=Identity(
            ticker="TEST",
            company_name="Test Inc.",
            as_of="2026-05-08",
            sector_etf="XLK",
            subsector_etf="SMH",
            market_cap_usd=1.0e12,
        ),
        core_metrics=CoreMetrics(
            beta=1.10, vol_23d=0.28, max_drawdown_pct=-0.18,
            sharpe_252d=1.45, residual_er=0.012,
            market_share=0.55, sector_share=0.20,
            subsector_share=0.10, residual_share=0.15,
        ),
        performance=PerformanceAttribution(
            window_label="1Y", window_start="2025-05-08", window_end="2026-05-08",
            series=[AttributionPoint("Market", 0.18, 0)],
        ),
        risk=RiskDecomposition(
            total_variance=0.0784,
            components=[
                DecompositionPoint("Market", 0.55, 0),
                DecompositionPoint("Sector", 0.20, 1),
                DecompositionPoint("Subsector", 0.10, 2),
                DecompositionPoint("Residual", 0.15, 3),
            ],
        ),
        aom=AomProvenance(
            composition="P1",
            subject_type="stock",
            subject_id="TEST",
            as_of="2026-05-08",
            lenses=["return_attribution", "risk_decomposition", "exposure"],
            resolution="full_stack",
            view="snapshot",
            attribution_mode="incremental",
            observation_mode="knowledge",
            ontology_version=CANONICAL_ONTOLOGY_VERSION,
        ),
        temporal=TemporalContext(
            observation_mode="knowledge",
            report_date="2026-05-08",
            filing_date="2026-05-08",
        ),
    )
    return json.dumps(asdict(snap), indent=2, default=str).encode("utf-8")
