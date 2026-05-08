"""Smoke tests for the canonical stock-snapshot contract.

Two layers:

  1. Schema round-trip (unconditional). Builds a minimal valid
     ``CanonicalStockSnapshot``, dumps to JSON, reloads, asserts the
     reload equals the original. Tests the contract itself, not data.

  2. Adapter + reference renderer (conditional on local DD cache,
     which is gitignored). Loads ``AAPL_dd_cache.json`` if present,
     converts via :func:`from_dd_data`, renders to PDF + PNG bytes,
     and asserts non-empty output. Skipped on CI / fresh checkouts.

Per the project rule against synthetic test data: the round-trip test
constructs a clearly-marked ``__TEST__`` snapshot to exercise
serialization only — it does not pretend to be real ticker data. The
end-to-end render path is covered by the real-fixture conditional test.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from riskmodels.snapshots.canonical import (
    AttributionPoint,
    CANONICAL_SCHEMA_VERSION,
    CanonicalStockSnapshot,
    CoreMetrics,
    DecompositionPoint,
    HedgeBasis,
    Identity,
    MacroBasis,
    PeerContext,
    PeerRow,
    PerformanceAttribution,
    RiskDecomposition,
    from_dd_data,
)


# ---------------------------------------------------------------------------
# 1. Schema round-trip
# ---------------------------------------------------------------------------

def _build_test_snapshot() -> CanonicalStockSnapshot:
    """Construct a schema-valid snapshot with obviously-test identity."""
    return CanonicalStockSnapshot(
        schema_version=CANONICAL_SCHEMA_VERSION,
        generated_utc="2026-05-08T00:00:00+00:00",
        identity=Identity(
            ticker="__TEST__",
            company_name="Test Fixture, Inc.",
            as_of="2026-05-08",
            sector_etf="XLK",
            subsector_etf="SMH",
            market_cap_usd=1.0e12,
            universe="uni_mc_3000",
        ),
        core_metrics=CoreMetrics(
            beta=1.10,
            vol_23d=0.28,
            max_drawdown_pct=-0.18,
            sharpe_252d=1.45,
            residual_er=0.012,
            residual_vol=0.085,
            market_share=0.55,
            sector_share=0.20,
            subsector_share=0.10,
            residual_share=0.15,
        ),
        performance=PerformanceAttribution(
            window_label="1Y",
            window_start="2025-05-08",
            window_end="2026-05-08",
            series=[
                AttributionPoint("Market", 0.18, 0),
                AttributionPoint("Sector", 0.05, 1),
                AttributionPoint("Subsector", 0.03, 2),
                AttributionPoint("Residual", 0.02, 3),
                AttributionPoint("Gross", 0.28, 4),
            ],
            trailing_returns={"__TEST__": 0.28, "SPY": 0.12},
            cumulative_curves={
                "__TEST__": [("2025-05-08", 0.0), ("2026-05-08", 0.28)],
                "SPY":      [("2025-05-08", 0.0), ("2026-05-08", 0.12)],
            },
            drawdown_curves={
                "__TEST__": [("2025-05-08", 0.0), ("2026-05-08", -0.05)],
            },
            uses_combined_factor_returns=False,
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
        peer=PeerContext(
            cohort_label="SMH peers",
            cohort_size=2,
            target=PeerRow(ticker="__TEST__", weight=0.30, residual_er=0.012),
            peers=[
                PeerRow(ticker="PEER1", weight=0.40, residual_er=0.005),
                PeerRow(ticker="PEER2", weight=0.30, residual_er=-0.002),
            ],
            selection_spread=0.010,
        ),
        hedge=HedgeBasis(market_hr=0.95, sector_hr=0.45, subsector_hr=0.85),
        macro=MacroBasis(
            correlations={"VIX": -0.42, "Oil": 0.10},
            window_label="252d",
        ),
    )


def test_schema_round_trip() -> None:
    """JSON dump + reload yields an equal snapshot."""
    snap = _build_test_snapshot()

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "test_snap.json"
        snap.to_json(out)

        # File parses as valid JSON
        raw = json.loads(out.read_text())
        assert raw["schema_version"] == CANONICAL_SCHEMA_VERSION
        assert raw["identity"]["ticker"] == "__TEST__"

        # Round-trip equality (frozen dataclasses → __eq__ is structural)
        reloaded = CanonicalStockSnapshot.from_json(out)
        assert reloaded == snap


def test_optional_sections_can_be_absent() -> None:
    """peer / hedge / macro are optional and survive a round-trip as None."""
    snap = CanonicalStockSnapshot(
        schema_version=CANONICAL_SCHEMA_VERSION,
        generated_utc="2026-05-08T00:00:00+00:00",
        identity=Identity(
            ticker="__TEST__", company_name="Test", as_of="2026-05-08",
            sector_etf=None, subsector_etf=None, market_cap_usd=None,
        ),
        core_metrics=CoreMetrics(),
        performance=PerformanceAttribution(
            window_label="1Y", window_start="2025-05-08", window_end="2026-05-08",
        ),
        risk=RiskDecomposition(),
    )

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "minimal.json"
        snap.to_json(out)
        reloaded = CanonicalStockSnapshot.from_json(out)

    assert reloaded.peer is None
    assert reloaded.hedge is None
    assert reloaded.macro is None
    assert reloaded.judgment is None
    assert reloaded == snap


# ---------------------------------------------------------------------------
# 2. Adapter + reference render — conditional on real cache
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
DD_CACHE = REPO_ROOT / "sdk" / "riskmodels" / "snapshots" / "output" / "AAPL_dd_cache.json"


@pytest.mark.skipif(not DD_CACHE.exists(), reason="AAPL_dd_cache.json not present (gitignored)")
def test_from_dd_data_renders() -> None:
    """Real DD cache → canonical → reference renderer produces non-empty PNG bytes."""
    from riskmodels.snapshots.stock_deep_dive import DDData
    from riskmodels.snapshots.reference_renderer import render_canonical_to_png_bytes

    dd = DDData.from_json(DD_CACHE)
    snap = from_dd_data(dd)

    # Identity flows through
    assert snap.identity.ticker == dd.p1.ticker
    assert snap.identity.as_of == dd.p1.teo

    # Variance shares are populated and roughly normalized
    shares = [
        snap.core_metrics.market_share,
        snap.core_metrics.sector_share,
        snap.core_metrics.subsector_share,
        snap.core_metrics.residual_share,
    ]
    if all(s is not None for s in shares):
        total = sum(shares)
        assert 0.99 <= total <= 1.01, f"variance shares should sum to ~1.0; got {total}"

    # Reference renderer produces non-empty PNG bytes
    png_bytes = render_canonical_to_png_bytes(snap)
    assert len(png_bytes) > 1000, "PNG output suspiciously small"
    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", "not a valid PNG header"
