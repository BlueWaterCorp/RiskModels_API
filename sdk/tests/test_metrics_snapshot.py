"""format_metrics_snapshot output smoke test."""

from __future__ import annotations

from riskmodels import format_metrics_snapshot


def test_format_metrics_snapshot_contains_ticker_and_legend() -> None:
    row = {
        "ticker": "NVDA",
        "teo": "2026-01-01",
        "l3_market_hr": 0.25,
        "l3_market_er": 0.4,
        "l3_sector_er": 0.2,
        "l3_subsector_er": 0.15,
        "l3_residual_er": 0.05,
        "vol_23d": 0.3,
    }
    text = format_metrics_snapshot(row)
    assert "NVDA" in text
    assert "2026-01-01" in text
    assert "0.25" in text  # formatted HR
    assert "ERM3" in text or "hedge" in text.lower()
