"""Smoke tests for the canonical fund-snapshot contract."""

from __future__ import annotations

import json
import tempfile
from dataclasses import replace
from pathlib import Path

from riskmodels.snapshots.canonical import (
    AttributionPoint,
    CoreMetrics,
    DecompositionPoint,
    HedgeBasis,
    MacroBasis,
    PeerContext,
    PeerRow,
    PerformanceAttribution,
    RiskDecomposition,
)
from riskmodels.snapshots.canonical_fund import (
    CANONICAL_FUND_SCHEMA_VERSION,
    CanonicalFundSnapshot,
    FilerMetadata,
    FundIdentity,
    FundPortfolio,
    HoldingRow,
)
from riskmodels.snapshots.reference_renderer_fund import (
    render_canonical_fund_to_pdf,
    render_canonical_fund_to_png,
    render_canonical_fund_to_png_bytes,
)


def _build_test_snapshot() -> CanonicalFundSnapshot:
    return CanonicalFundSnapshot(
        schema_version=CANONICAL_FUND_SCHEMA_VERSION,
        generated_utc="2026-05-08T00:00:00+00:00",
        identity=FundIdentity(
            symbol_id="__TEST_FUND__",
            name="Test Fund, Inc.",
            as_of="2026-05-08",
            fund_family="Test Family",
            share_class_count=3,
            expense_ratio=0.005,
            aum_usd=1.0e10,
            inception_date="2010-01-01",
            filer_metadata=None,
        ),
        core_metrics=CoreMetrics(
            beta=1.05,
            vol_23d=0.15,
            max_drawdown_pct=-0.12,
            sharpe_252d=0.9,
            residual_er=0.35,
            residual_vol=0.08,
            market_share=0.40,
            sector_share=0.25,
            subsector_share=0.20,
            residual_share=0.15,
        ),
        performance=PerformanceAttribution(
            window_label="1Y",
            window_start="2025-05-08",
            window_end="2026-05-08",
            series=[
                AttributionPoint("Market", 0.12, 0),
                AttributionPoint("Sector", 0.04, 1),
                AttributionPoint("Subsector", 0.02, 2),
                AttributionPoint("Residual", 0.06, 3),
                AttributionPoint("Gross", 0.24, 4),
            ],
            trailing_returns={"__TEST_FUND__": 0.24, "SPY": 0.12},
            cumulative_curves={
                "__TEST_FUND__": [("2025-05-08", 0.0), ("2026-05-08", 0.24)],
                "SPY": [("2025-05-08", 0.0), ("2026-05-08", 0.12)],
            },
            drawdown_curves={
                "__TEST_FUND__": [("2025-05-08", 0.0), ("2026-05-08", -0.04)],
            },
            uses_combined_factor_returns=False,
        ),
        risk=RiskDecomposition(
            total_variance=0.0225,
            components=[
                DecompositionPoint("Market", 0.40, 0),
                DecompositionPoint("Sector", 0.25, 1),
                DecompositionPoint("Subsector", 0.20, 2),
                DecompositionPoint("Residual", 0.15, 3),
            ],
        ),
        portfolio=FundPortfolio(
            holdings=[
                HoldingRow("AAPL", 0.08, 1.2e9, None, 0.10, 0.02, 0.03, 0.02),
                HoldingRow("MSFT", 0.07, 1.0e9),
                HoldingRow("NVDA", 0.06, 0.9e9),
                HoldingRow("GOOGL", 0.05, 0.75e9),
                HoldingRow("AMZN", 0.045, 0.7e9),
            ],
            total_holdings_count=120,
            coverage_pct=0.85,
        ),
        peer=PeerContext(
            cohort_label="Large growth peers",
            cohort_size=2,
            target=PeerRow(ticker="PEER_FUND", weight=0.5, residual_er=0.10),
            peers=[
                PeerRow(ticker="PEER_A", weight=0.3, residual_er=0.08),
                PeerRow(ticker="PEER_B", weight=0.2, residual_er=0.12),
            ],
            selection_spread=0.02,
        ),
        hedge=HedgeBasis(market_hr=0.88, sector_hr=0.35, subsector_hr=0.72),
        macro=MacroBasis(correlations={"VIX": -0.30}, window_label="252d"),
    )


def test_schema_round_trip() -> None:
    snap = _build_test_snapshot()
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "fund_snap.json"
        snap.to_json(out)
        raw = json.loads(out.read_text())
        assert raw["schema_version"] == CANONICAL_FUND_SCHEMA_VERSION
        assert raw["identity"]["symbol_id"] == "__TEST_FUND__"
        reloaded = CanonicalFundSnapshot.from_json(out)
        assert reloaded == snap


def test_optional_sections_can_be_absent() -> None:
    snap = CanonicalFundSnapshot(
        schema_version=CANONICAL_FUND_SCHEMA_VERSION,
        generated_utc="2026-05-08T00:00:00+00:00",
        identity=FundIdentity(
            symbol_id="__TEST_FUND__",
            name="Test",
            as_of="2026-05-08",
        ),
        core_metrics=CoreMetrics(),
        performance=PerformanceAttribution(
            window_label="1Y",
            window_start="2025-05-08",
            window_end="2026-05-08",
        ),
        risk=RiskDecomposition(),
        portfolio=FundPortfolio(),
    )
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "minimal_fund.json"
        snap.to_json(out)
        reloaded = CanonicalFundSnapshot.from_json(out)
    assert reloaded.peer is None
    assert reloaded.hedge is None
    assert reloaded.macro is None
    assert reloaded.judgment is None
    assert reloaded.aom is None
    assert reloaded.temporal is None
    assert reloaded == snap


def test_filer_metadata_optional() -> None:
    base = _build_test_snapshot()
    with_filer = CanonicalFundSnapshot(
        schema_version=base.schema_version,
        generated_utc=base.generated_utc,
        identity=FundIdentity(
            symbol_id="BW-FILER-0001",
            name="Adviser Example LLC",
            as_of="2026-05-08",
            filer_metadata=FilerMetadata(
                cik="0001234567",
                filer_type="investment_adviser",
                aum_tier="large",
            ),
        ),
        core_metrics=base.core_metrics,
        performance=base.performance,
        risk=base.risk,
        portfolio=base.portfolio,
    )
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "m1_shape.json"
        with_filer.to_json(out)
        back = CanonicalFundSnapshot.from_json(out)
    assert back.identity.filer_metadata == with_filer.identity.filer_metadata

    none_snap = CanonicalFundSnapshot(
        schema_version=base.schema_version,
        generated_utc=base.generated_utc,
        identity=FundIdentity(
            symbol_id="__TEST_FUND__",
            name="Test",
            as_of="2026-05-08",
            filer_metadata=None,
        ),
        core_metrics=base.core_metrics,
        performance=base.performance,
        risk=base.risk,
        portfolio=base.portfolio,
    )
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "f1_only.json"
        none_snap.to_json(p)
        back2 = CanonicalFundSnapshot.from_json(p)
    assert back2.identity.filer_metadata is None


def _build_test_fund_snapshot() -> CanonicalFundSnapshot:
    return _build_test_snapshot()


def _build_test_fund_snapshot_no_holdings() -> CanonicalFundSnapshot:
    base = _build_test_fund_snapshot()
    return replace(
        base,
        portfolio=FundPortfolio(
            holdings=[],
            total_holdings_count=base.portfolio.total_holdings_count,
            coverage_pct=base.portfolio.coverage_pct,
        ),
    )


def _build_test_filer_snapshot() -> CanonicalFundSnapshot:
    base = _build_test_fund_snapshot()
    return replace(
        base,
        identity=FundIdentity(
            symbol_id="BW-FILER-0001",
            name="Adviser Example LLC",
            as_of="2026-05-08",
            filer_metadata=FilerMetadata(
                cik="0001234567",
                filer_type="investment_adviser",
                aum_tier="large",
            ),
        ),
    )


def test_render_pdf_produces_valid_pdf(tmp_path: Path) -> None:
    snap = _build_test_fund_snapshot()
    out = tmp_path / "test_fund.pdf"
    render_canonical_fund_to_pdf(snap, out)
    assert out.exists()
    assert out.stat().st_size > 1000
    assert out.read_bytes()[:5] == b"%PDF-"


def test_render_png_bytes_deterministic() -> None:
    snap = _build_test_fund_snapshot()
    a = render_canonical_fund_to_png_bytes(snap)
    b = render_canonical_fund_to_png_bytes(snap)
    assert a == b
    assert a[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(a) > 1000


def test_render_handles_empty_holdings(tmp_path: Path) -> None:
    snap = _build_test_fund_snapshot_no_holdings()
    out = tmp_path / "empty.png"
    render_canonical_fund_to_png(snap, out)
    assert out.exists()


def test_render_handles_filer_identity(tmp_path: Path) -> None:
    snap = _build_test_filer_snapshot()
    out = tmp_path / "filer.png"
    render_canonical_fund_to_png(snap, out)
    assert out.exists()
