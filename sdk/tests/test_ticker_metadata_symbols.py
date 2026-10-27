"""get_ticker_metadata / PeerGroupProxy read the symbols registry (BW taxonomy labels), not ticker_metadata (ERM3-41).

Fixture rows are production rows read 2026-10-27 (symbols + security_history_latest, GGME cohort)."""
from __future__ import annotations

import warnings

import httpx
import pytest

from riskmodels import RiskModelsClient
from riskmodels.peer_group import PeerGroupProxy

SYMBOLS = [
    {"symbol": "BW-BBG000BH4R78", "ticker": "DIS", "name": "Walt Disney Company", "sector_etf": "XLC", "subsector_etf": "GGME"},
    {"symbol": "BW-BBG000CL9VN6", "ticker": "NFLX", "name": "Netflix, Inc.", "sector_etf": "XLC", "subsector_etf": "GGME"},
    {"symbol": "BW-BBG003T4VFC2", "ticker": "SPOT", "name": "Spotify Technology SA", "sector_etf": "XLC", "subsector_etf": "GGME"},
]
CAPS = {"BW-BBG000BH4R78": 191710871552, "BW-BBG000CL9VN6": 272297066496, "BW-BBG003T4VFC2": 117810298880}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    calls: list[tuple[str, dict]] = []

    def fake_get(url, params=None, headers=None, timeout=None):
        table = url.rsplit("/", 1)[-1]
        calls.append((table, dict(params or {})))
        assert table in ("symbols", "security_history_latest"), table
        if table == "symbols":
            rows = SYMBOLS
            for col in ("ticker", "sector_etf", "subsector_etf"):
                if col in params:
                    rows = [r for r in rows if r[col] == params[col].removeprefix("eq.")]
        else:
            ids = params["symbol"].removeprefix("in.(").rstrip(")").replace('"', "").split(",")
            rows = [{"symbol": s, "market_cap": CAPS[s]} for s in ids if s in CAPS]
        return httpx.Response(200, json=rows, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    c = RiskModelsClient(base_url="https://riskmodels.app/api", api_key="x")
    c._calls = calls  # type: ignore[attr-defined]
    return c


def test_labels_come_from_symbols_and_caps_from_latest(client):
    rows = client.get_ticker_metadata(subsector_etf="GGME", columns="*", as_dataframe=False)
    assert [r["ticker"] for r in rows] == ["NFLX", "DIS", "SPOT"]          # market_cap desc
    assert rows[1] == {"ticker": "DIS", "symbol": "BW-BBG000BH4R78", "company_name": "Walt Disney Company",
                       "market_cap": 191710871552, "sector_etf": "XLC", "subsector_etf": "GGME"}
    assert {t for t, _ in client._calls} == {"symbols", "security_history_latest"}


def test_columns_are_projected_and_unknown_columns_refused(client):
    df = client.get_ticker_metadata(ticker="DIS", columns="company_name")
    assert list(df.columns) == ["company_name"] and df.iloc[0]["company_name"] == "Walt Disney Company"
    assert all(t == "symbols" for t, _ in client._calls)                  # no cap read when not asked
    with pytest.raises(ValueError, match="unsupported column"):
        client.get_ticker_metadata(columns="ticker,dollar_volume")


def test_peer_group_uses_the_registry_cohort(client):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pg = PeerGroupProxy.from_ticker(client, "DIS", min_peers=2)
    assert (pg.group_by, pg.sector_etf) == ("subsector_etf", "GGME")
    assert pg.peer_tickers == ["NFLX", "SPOT"]
    assert pg.weights["NFLX"] == pytest.approx(272297066496 / (272297066496 + 117810298880))
