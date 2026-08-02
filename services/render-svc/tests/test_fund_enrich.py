"""Private render-svc fund enrich (PostgREST) — not part of public SDK."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

import pytest

from render_svc import fund_enrich


@dataclass
class FakeHolding:
    symbol: str
    ticker: str
    company_name: str
    weight: float
    sector_etf: str | None = None
    subsector_etf: str | None = None
    market_share: float | None = None
    sector_share: float | None = None
    subsector_share: float | None = None
    style_share: float | None = None
    residual_share: float | None = None


@dataclass
class FakeFundData:
    bw_fund_id: str
    ticker_primary: str | None = None
    fund_name: str | None = None
    holdings: list[FakeHolding] = field(default_factory=list)
    historical_degradations: list[str] = field(default_factory=list)


@pytest.fixture(autouse=True)
def _clear_creds(monkeypatch):
    for var in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ):
        monkeypatch.delenv(var, raising=False)


def test_creds_none_when_unset():
    assert fund_enrich._supabase_creds() is None


def test_enrich_soft_fails_without_creds(monkeypatch):
    monkeypatch.setattr(
        fund_enrich,
        "FundHolding",
        FakeHolding,
        raising=False,
    )
    # Patch import inside enrich_fund_data
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)

    fd = FakeFundData(
        bw_fund_id="BW-FUND-X",
        holdings=[
            FakeHolding(
                symbol="BW-FIGI-X",
                ticker="BW-FIGI-X",
                company_name="BW-FIGI-X",
                weight=1.0,
            )
        ],
    )
    out = fund_enrich.enrich_fund_data(fd)
    assert out.holdings[0].ticker == "BW-FIGI-X"


def test_enrich_maps_tickers(monkeypatch):
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)

    def fake_query(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        if path == "symbols":
            return [
                {
                    "symbol": "BW-FIGI-X",
                    "ticker": "AAPL",
                    "name": "Apple Inc.",
                    "sector_etf": "XLK",
                    "subsector_etf": "QQQ",
                }
            ]
        if path == "security_history_latest":
            return [
                {
                    "symbol": "BW-FIGI-X",
                    "l3_mkt_er": 0.4,
                    "l3_sec_er": 0.2,
                    "l3_sub_er": 0.1,
                    "l3_res_er": 0.3,
                }
            ]
        return []

    monkeypatch.setattr(fund_enrich, "_supabase_query", fake_query)
    fd = FakeFundData(
        bw_fund_id="BW-FUND-X",
        holdings=[
            FakeHolding(
                symbol="BW-FIGI-X",
                ticker="BW-FIGI-X",
                company_name="BW-FIGI-X",
                weight=1.0,
            )
        ],
    )
    out = fund_enrich.enrich_fund_data(fd)
    assert out.holdings[0].ticker == "AAPL"
    assert out.holdings[0].market_share == pytest.approx(0.4)


# ---------------------------------------------------------------------------
# H.147 — the G.44 degradation marker must gate the share overlay upstream,
# so no call path can re-overlay current-model shares on a historical read.
# ---------------------------------------------------------------------------


def _fake_query_with_shares(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    if path == "symbols":
        return [
            {
                "symbol": "BW-FIGI-X",
                "ticker": "AAPL",
                "name": "Apple Inc.",
                "sector_etf": "XLK",
                "subsector_etf": "QQQ",
            }
        ]
    if path == "security_history_latest":
        return [
            {
                "symbol": "BW-FIGI-X",
                "l3_mkt_er": 0.4,
                "l3_sec_er": 0.2,
                "l3_sub_er": 0.1,
                "l3_res_er": 0.3,
            }
        ]
    return []


def _historical_fund(marker: bool) -> FakeFundData:
    return FakeFundData(
        bw_fund_id="BW-FUND-X",
        historical_degradations=(
            ["holdings_model_share_overlay_skipped"] if marker else []
        ),
        holdings=[
            FakeHolding(
                symbol="BW-FIGI-X",
                ticker="BW-FIGI-X",
                company_name="BW-FIGI-X",
                weight=1.0,
                market_share=None,
                sector_share=None,
                subsector_share=None,
                style_share=None,
                residual_share=None,
            )
        ],
    )


def test_marker_skips_share_overlay_but_keeps_labels(monkeypatch):
    """With the G.44 marker, live creds must NOT re-apply current-model shares."""
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)
    monkeypatch.setattr(fund_enrich, "_supabase_query", _fake_query_with_shares)

    out = fund_enrich.enrich_fund_data(_historical_fund(marker=True))

    # Label resolution still runs.
    assert out.holdings[0].ticker == "AAPL"
    assert out.holdings[0].company_name == "Apple Inc."
    assert out.holdings[0].sector_etf == "XLK"
    # Share overlay withheld: the holding keeps its (skipped) None shares.
    assert out.holdings[0].market_share is None
    assert out.holdings[0].sector_share is None
    assert out.holdings[0].subsector_share is None
    assert out.holdings[0].style_share is None
    assert out.holdings[0].residual_share is None


def test_marker_skips_the_share_query_entirely(monkeypatch):
    """No security_history_latest round-trip when the overlay is withheld."""
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)
    paths: list[str] = []

    def recording_query(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        paths.append(path)
        return _fake_query_with_shares(path, params)

    monkeypatch.setattr(fund_enrich, "_supabase_query", recording_query)
    fund_enrich.enrich_fund_data(_historical_fund(marker=True))
    assert "security_history_latest" not in paths


def test_no_marker_overlay_unchanged(monkeypatch):
    """Without the marker the overlay behaves exactly as before."""
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)
    monkeypatch.setattr(fund_enrich, "_supabase_query", _fake_query_with_shares)

    out = fund_enrich.enrich_fund_data(_historical_fund(marker=False))

    assert out.holdings[0].ticker == "AAPL"
    assert out.holdings[0].market_share == pytest.approx(0.4)
    assert out.holdings[0].sector_share == pytest.approx(0.2)
    assert out.holdings[0].subsector_share == pytest.approx(0.1)
    assert out.holdings[0].residual_share == pytest.approx(0.3)


def test_unrelated_degradation_does_not_skip_overlay(monkeypatch):
    """Only the share-overlay marker gates the overlay, not any degradation."""
    import riskmodels.snapshots as snaps

    monkeypatch.setattr(snaps, "FundHolding", FakeHolding, raising=False)
    monkeypatch.setattr(fund_enrich, "_supabase_query", _fake_query_with_shares)

    fd = _historical_fund(marker=False)
    fd.historical_degradations = ["benchmark_fit_omitted"]
    out = fund_enrich.enrich_fund_data(fd)
    assert out.holdings[0].market_share == pytest.approx(0.4)
