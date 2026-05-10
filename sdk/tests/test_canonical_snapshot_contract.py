"""Real-fixture contract test for the canonical stock snapshot pipeline.

Gates the GCS pre-render batch: round-trip + render determinism on real
P1Data caches. Failing this test means the published artifacts cannot be
trusted to be reproducible on a re-run with the same inputs — i.e. the
``rm_api_public`` bucket would drift between batches even when nothing
upstream changed.

Lives at the public boundary (``riskmodels.snapshots.*``) — never imports
``bwmacro.*`` — so it runs unchanged inside the bucket pipeline VM with
only the public SDK installed.

Companion to :mod:`riskmodels.snapshots.contract_check`, which exposes
the same checks as a ``python -m`` CLI gate.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import asdict
from pathlib import Path

import pytest

from riskmodels.snapshots import (
    AomProvenance,
    CanonicalStockSnapshot,
    OBSERVATION_MODES,
    P1Data,
    TemporalContext,
    from_components,
    render_canonical_to_pdf,
    render_canonical_to_png_bytes,
)
from riskmodels.snapshots.canonical import (
    CANONICAL_ONTOLOGY_VERSION,
    CANONICAL_SCHEMA_VERSION,
)


# AOM_SPEC v1 string vocabulary — the provenance block must use these literals.
AOM_LENSES = {"return_attribution", "risk_decomposition", "exposure"}
AOM_RESOLUTIONS = {"market_only", "market_sector", "full_stack"}
AOM_VIEWS = {"snapshot", "timeseries", "distribution"}
AOM_ATTRIBUTION_MODES = {"incremental", "cumulative"}


# Fixtures live alongside the SDK source (gitignored cache).
FIXTURE_DIR = (
    Path(__file__).resolve().parent.parent
    / "riskmodels"
    / "snapshots"
    / "output"
)

# Pinned timestamp so the same canonical produces byte-stable JSON across
# runs. Production batches should pass their trading-day close instead.
PINNED_GENERATED_UTC = "2026-01-01T00:00:00+00:00"


def _fixtures() -> list[Path]:
    if not FIXTURE_DIR.exists():
        return []
    return sorted(FIXTURE_DIR.glob("*_p1_cache.json"))


def _ticker(p: Path) -> str:
    return p.stem.replace("_p1_cache", "")


FIXTURES = _fixtures()

if not FIXTURES:
    pytest.skip(
        f"No P1 cache fixtures present at {FIXTURE_DIR} "
        "(gitignored on fresh checkouts).",
        allow_module_level=True,
    )


@pytest.mark.parametrize("fixture", FIXTURES, ids=[_ticker(p) for p in FIXTURES])
class TestCanonicalContract:
    """Each method enforces one guarantee the pre-render batch relies on."""

    def test_adapter_idempotent(self, fixture: Path) -> None:
        """``from_components`` is deterministic when ``generated_utc`` is pinned.

        If a caller forgets to pin ``generated_utc``, two adapter calls produce
        snapshots that differ only in their wall-clock timestamp. Downstream
        cache hashes treat that as drift even though the underlying data is
        unchanged. The batch job MUST pin this value (e.g. trading-day close).
        """
        p1 = P1Data.from_json(fixture)
        a = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        b = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        assert a == b

    def test_json_serialization_stable(self, fixture: Path) -> None:
        """Dumping the same snapshot twice produces byte-identical JSON."""
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        a = json.dumps(asdict(snap), sort_keys=True, default=str)
        b = json.dumps(asdict(snap), sort_keys=True, default=str)
        assert a == b

    def test_json_round_trip(self, fixture: Path, tmp_path: Path) -> None:
        """Dump → reload yields a structurally equal snapshot on real data."""
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        out = tmp_path / "snap.json"
        snap.to_json(out)
        reloaded = CanonicalStockSnapshot.from_json(out)
        assert reloaded == snap

    def test_invariants(self, fixture: Path) -> None:
        """Schema version + ontology version + identity + variance-share invariants.

        ``schema_version`` and ``ontology_version`` are independent axes:
        the first locks data shape, the second locks semantic meaning of the
        decomposition / hedge / residual / Judgment vocabulary. Both must be
        present on every published canonical so consumers can detect drift.
        """
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)

        assert snap.schema_version == CANONICAL_SCHEMA_VERSION
        assert snap.ontology_version == CANONICAL_ONTOLOGY_VERSION
        assert snap.identity.ticker == p1.ticker
        assert snap.identity.as_of == p1.teo

        cm = snap.core_metrics
        shares = [cm.market_share, cm.sector_share, cm.subsector_share, cm.residual_share]
        if all(s is not None for s in shares):
            total = sum(shares)
            assert 0.99 <= total <= 1.01, (
                f"variance shares should sum to ~1.0; got {total:.4f}"
            )

    def test_png_render_deterministic(self, fixture: Path) -> None:
        """Two PNG renders of the same canonical produce byte-identical bytes.

        Within one process+library version, matplotlib output must be stable.
        That stability is what lets the pre-render batch publish to GCS as
        an immutable artifact: cached consumers reading
        ``gs://.../p1/{TICKER}/{date}.png`` see the same bytes on every fetch.
        """
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        a = render_canonical_to_png_bytes(snap)
        b = render_canonical_to_png_bytes(snap)
        assert a == b, "PNG bytes drift between two renders of the same canonical"
        assert a[:8] == b"\x89PNG\r\n\x1a\n", "PNG header missing"
        assert len(a) > 1000, f"PNG output suspiciously small ({len(a)} bytes)"

    def test_aom_provenance_populated_and_valid(self, fixture: Path) -> None:
        """Every canonical carries an ``AomProvenance`` block with v1 vocabulary.

        Without this, an agent reading a snapshot from GCS cannot re-issue the
        underlying analysis or chain a ``hedge_action`` onto it (per
        AOM_SPEC §4 ``ChainStage``). The block is what makes a P1 a node in
        the agent graph rather than a terminal artifact.
        """
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)

        assert snap.aom is not None, "canonical snapshot is missing aom provenance"
        prov = snap.aom

        # Composition + subject identity match the snapshot identity
        assert prov.composition == "P1"
        assert prov.subject_type == "stock"
        assert prov.subject_id == snap.identity.ticker
        assert prov.as_of == snap.identity.as_of

        # AOM_SPEC v1 string vocabulary
        for lens in prov.lenses:
            assert lens in AOM_LENSES, f"unknown AOM lens: {lens!r}"
        assert prov.view in AOM_VIEWS
        if prov.resolution is not None:
            assert prov.resolution in AOM_RESOLUTIONS
        if prov.attribution_mode is not None:
            assert prov.attribution_mode in AOM_ATTRIBUTION_MODES

        # Provenance carries its own ontology stamp; must agree with the snapshot's.
        assert prov.ontology_version == snap.ontology_version

    def test_aom_provenance_round_trip(self, fixture: Path, tmp_path: Path) -> None:
        """AOM provenance survives JSON dump → reload byte-stable."""
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)

        out = tmp_path / "snap.json"
        snap.to_json(out)
        reloaded = CanonicalStockSnapshot.from_json(out)

        assert reloaded.aom == snap.aom
        assert isinstance(reloaded.aom, AomProvenance)

    def test_temporal_context_populated_and_valid(self, fixture: Path) -> None:
        """Every canonical declares a bi-temporal observational frame.

        A canonical without ``temporal`` cannot be safely consumed by
        backtests, simulations, or audit-replay tooling — the analysis is
        ambiguous about whether it represents reality, knowledge, or system
        time. The gate exists to prevent that ambiguity from reaching the
        GCS bucket.
        """
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)

        assert snap.temporal is not None, "canonical missing temporal context"
        t = snap.temporal

        assert t.observation_mode in OBSERVATION_MODES, (
            f"observation_mode={t.observation_mode!r} not in {OBSERVATION_MODES}"
        )
        assert t.report_date == snap.identity.as_of, (
            "temporal.report_date must agree with Identity.as_of for stocks"
        )
        # Stocks: filing_date collapses to report_date.
        assert t.filing_date == t.report_date

        # AOM provenance carries the same observation_mode (re-issue determinism).
        assert snap.aom is not None
        assert snap.aom.observation_mode == t.observation_mode

    def test_temporal_round_trip(self, fixture: Path, tmp_path: Path) -> None:
        """Temporal context survives JSON dump → reload byte-stable."""
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)

        out = tmp_path / "snap.json"
        snap.to_json(out)
        reloaded = CanonicalStockSnapshot.from_json(out)

        assert reloaded.temporal == snap.temporal
        assert isinstance(reloaded.temporal, TemporalContext)

    def test_pdf_renders(self, fixture: Path, tmp_path: Path) -> None:
        """PDF render path executes successfully on real data.

        PDF byte-determinism is not asserted: matplotlib embeds a /CreationDate
        in the PDF metadata that varies per render. The batch should treat the
        PNG as the determinism anchor and produce the PDF as a derived artifact.
        """
        p1 = P1Data.from_json(fixture)
        snap = from_components(p1, generated_utc=PINNED_GENERATED_UTC)
        out = tmp_path / "snap.pdf"
        render_canonical_to_pdf(snap, out)
        assert out.exists()
        assert out.stat().st_size > 1000
        assert out.read_bytes()[:5] == b"%PDF-"
