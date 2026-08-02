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
    as_of_requested: str | None = None
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


def test_enrich_skips_l3_overlay_on_historical_as_of(monkeypatch):
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
        as_of_requested="2024-06-30",
        historical_degradations=["current_model_shares"],
        holdings=[
            FakeHolding(
                symbol="BW-FIGI-X",
                ticker="BW-FIGI-X",
                company_name="BW-FIGI-X",
                weight=1.0,
                market_share=None,
            )
        ],
    )
    out = fund_enrich.enrich_fund_data(fd)
    assert out.holdings[0].ticker == "AAPL"
    assert out.holdings[0].market_share is None
