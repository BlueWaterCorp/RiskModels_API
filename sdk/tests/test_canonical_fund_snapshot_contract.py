"""Real-fixture contract test for the canonical fund snapshot pipeline."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from riskmodels.snapshots import (
    AomProvenance,
    CanonicalFundSnapshot,
    FundData,
    OBSERVATION_MODES,
    TemporalContext,
    from_fund_components,
    render_canonical_fund_to_pdf,
)
from riskmodels.snapshots.canonical import CANONICAL_ONTOLOGY_VERSION
from riskmodels.snapshots.canonical_fund import CANONICAL_FUND_SCHEMA_VERSION

AOM_LENSES = {"return_attribution", "risk_decomposition", "exposure"}
AOM_RESOLUTIONS = {"market_only", "market_sector", "full_stack"}
AOM_VIEWS = {"snapshot", "timeseries", "distribution"}
AOM_ATTRIBUTION_MODES = {"incremental", "cumulative"}

FIXTURE_DIR = (
    Path(__file__).resolve().parent.parent
    / "riskmodels"
    / "snapshots"
    / "output"
)

PINNED_GENERATED_UTC = "2026-01-01T00:00:00+00:00"


def _fixtures() -> list[Path]:
    if not FIXTURE_DIR.exists():
        return []
    return sorted(FIXTURE_DIR.glob("*_f1_cache.json"))


def _fund_id(p: Path) -> str:
    return p.stem.replace("_f1_cache", "")


FIXTURES = _fixtures()


def test_f1_contract_skips_cleanly_without_fixtures() -> None:
    if not FIXTURES:
        pytest.skip(
            f"No F1 cache fixtures present at {FIXTURE_DIR} "
            "(gitignored on fresh checkouts)."
        )


if FIXTURES:

    @pytest.mark.parametrize("fixture", FIXTURES, ids=[_fund_id(p) for p in FIXTURES])
    class TestCanonicalFundContract:
        def test_adapter_idempotent(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            a = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            b = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            assert a == b

        def test_json_serialization_stable(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            x = json.dumps(asdict(snap), sort_keys=True, default=str)
            y = json.dumps(asdict(snap), sort_keys=True, default=str)
            assert x == y

        def test_json_round_trip(self, fixture: Path, tmp_path: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            out = tmp_path / "fund_snap.json"
            snap.to_json(out)
            reloaded = CanonicalFundSnapshot.from_json(out)
            assert reloaded == snap

        def test_invariants(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)

            assert snap.schema_version == CANONICAL_FUND_SCHEMA_VERSION
            assert snap.ontology_version == CANONICAL_ONTOLOGY_VERSION
            assert snap.identity.symbol_id == fd.symbol_id
            assert snap.identity.as_of == fd.teo

            cm = snap.core_metrics
            # FF2 (v4) 5-leg decomposition: market+sector+subsector+style+residual
            # sum to ~1 (style_share is 0 on pre-v4 funds).
            shares = [cm.market_share, cm.sector_share, cm.subsector_share,
                      cm.style_share, cm.residual_share]
            if all(s is not None for s in shares):
                total = sum(shares)
                assert 0.99 <= total <= 1.01

        def test_aom_provenance_populated_and_valid(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)

            assert snap.aom is not None
            prov = snap.aom
            assert prov.composition == "F1"
            assert prov.subject_type == "fund"
            assert prov.subject_id == snap.identity.symbol_id
            assert prov.as_of == snap.identity.as_of

            for lens in prov.lenses:
                assert lens in AOM_LENSES
            assert prov.view in AOM_VIEWS
            if prov.resolution is not None:
                assert prov.resolution in AOM_RESOLUTIONS
            if prov.attribution_mode is not None:
                assert prov.attribution_mode in AOM_ATTRIBUTION_MODES
            assert prov.ontology_version == snap.ontology_version

        def test_aom_provenance_round_trip(self, fixture: Path, tmp_path: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            out = tmp_path / "fund_snap.json"
            snap.to_json(out)
            reloaded = CanonicalFundSnapshot.from_json(out)
            assert reloaded.aom == snap.aom
            assert isinstance(reloaded.aom, AomProvenance)

        def test_temporal_context_populated_and_valid(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)

            assert snap.temporal is not None
            t = snap.temporal
            assert t.observation_mode in OBSERVATION_MODES
            assert t.report_date == snap.identity.as_of
            expect_filing = fd.filing_date if fd.filing_date else fd.teo
            assert t.filing_date == expect_filing
            assert snap.aom is not None
            assert snap.aom.observation_mode == t.observation_mode

        def test_temporal_round_trip(self, fixture: Path, tmp_path: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            out = tmp_path / "fund_snap.json"
            snap.to_json(out)
            reloaded = CanonicalFundSnapshot.from_json(out)
            assert reloaded.temporal == snap.temporal
            assert isinstance(reloaded.temporal, TemporalContext)

        def test_pdf_renders(self, fixture: Path, tmp_path: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            out = tmp_path / "fund.pdf"
            render_canonical_fund_to_pdf(snap, out)
            assert out.exists()
            assert out.stat().st_size > 1000
            assert out.read_bytes()[:5] == b"%PDF-"

        def test_portfolio_invariants(self, fixture: Path) -> None:
            fd = FundData.from_json(fixture)
            snap = from_fund_components(fd, generated_utc=PINNED_GENERATED_UTC)
            port = snap.portfolio
            if port.coverage_pct is not None:
                assert 0.0 <= port.coverage_pct <= 1.0
            for h in port.holdings:
                assert 0.0 <= h.weight <= 1.0
            assert len(port.holdings) <= port.total_holdings_count
