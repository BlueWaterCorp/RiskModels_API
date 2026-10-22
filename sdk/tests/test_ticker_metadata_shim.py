"""``get_ticker_metadata`` reads ``symbols`` + ``security_history_latest``.

The legacy ``ticker_metadata`` table has no writer and drifted from the
model, so the method is a compatibility shim over the registry. The fixture
holds real rows read from Supabase on 2026-10-22 (every ``symbols`` row with
sector ETF XLU and its latest daily market cap). Only the internal symbol key
is replaced by an opaque join key. HTTP is served from those rows by a small
PostgREST emulator so the real client method and ``PeerGroupProxy`` run end
to end.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

import httpx
import pytest

from riskmodels.client import RiskModelsClient
from riskmodels.peer_group import PeerGroupProxy

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "symbols_xlu_labels_20261022.json").read_text()
)
PPA_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "symbols_ppa_placeholder_20261022.json").read_text()
)
SYMBOLS = FIXTURE["symbols"]
LATEST = FIXTURE["security_history_latest"]
BY_TICKER = {r["ticker"]: r for r in SYMBOLS}
_CAP_BY_SYMBOL = {c["symbol"]: c["market_cap"] for c in LATEST}
CAP_BY_TICKER = {r["ticker"]: _CAP_BY_SYMBOL.get(r["symbol"]) for r in SYMBOLS}


class _Client:
    """Bare carrier for the unbound method (it uses no client state)."""

    def get_ticker_metadata(self, **kw: Any):
        return RiskModelsClient.get_ticker_metadata(self, **kw)  # type: ignore[arg-type]


@pytest.fixture
def requests(monkeypatch) -> list[tuple[str, dict[str, str]]]:
    monkeypatch.setenv("SUPABASE_URL", "https://stub.local")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "stub-key")
    seen: list[tuple[str, dict[str, str]]] = []

    def fake_get(url: str, *, params: dict[str, str], headers: dict[str, str], timeout: float):
        table = url.rsplit("/", 1)[-1]
        seen.append((table, dict(params)))
        if table == "symbols":
            rows = list(SYMBOLS) + list(PPA_FIXTURE["symbols"])
            for col in ("ticker", "sector_etf", "subsector_etf", "asset_type"):
                if col in params:
                    if params[col] == "not.like.*#*":
                        rows = [r for r in rows if "#" not in str(r.get(col, ""))]
                    else:
                        want = params[col].removeprefix("eq.")
                        rows = [r for r in rows if r.get(col) == want]
            rows.sort(key=lambda r: r["symbol"])
            cols = params["select"].split(",")
        elif table == "security_history_latest":
            keys = {k.strip('"') for k in params["symbol"][len("in.(") : -1].split(",")}
            cap_rows = list(LATEST) + list(PPA_FIXTURE["security_history_latest"])
            rows = [r for r in cap_rows if r["symbol"] in keys and r["periodicity"] == "daily"]
            cols = params["select"].split(",")
        else:
            raise AssertionError(f"unexpected table {table}")
        off, lim = int(params["offset"]), int(params["limit"])
        body = [{c: r.get(c) for c in cols} for r in rows[off : off + lim]]
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    return seen


def test_never_reads_legacy_table(requests):
    _Client().get_ticker_metadata(ticker="AEE")
    _Client().get_ticker_metadata(subsector_etf="FIW")
    assert {t for t, _ in requests} == {"symbols", "security_history_latest"}


def test_ticker_lookup_keeps_legacy_columns(requests):
    df = _Client().get_ticker_metadata(ticker="aee")
    assert list(df.columns) == ["ticker", "company_name", "market_cap", "sector_etf", "subsector_etf"]
    row = df.iloc[0].to_dict()
    src = BY_TICKER["AEE"]
    assert row["ticker"] == "AEE"
    assert row["company_name"] == src["name"]
    assert row["sector_etf"] == src["sector_etf"]
    assert row["subsector_etf"] == src["subsector_etf"]
    assert row["market_cap"] == CAP_BY_TICKER["AEE"]
    # Exact ticker lookups do not filter on asset type.
    sym_params = [p for t, p in requests if t == "symbols"]
    assert sym_params[0]["ticker"] == "eq.AEE"
    assert "asset_type" not in sym_params[0]


def test_unknown_ticker_is_empty(requests):
    assert _Client().get_ticker_metadata(ticker="NOPE").empty


def test_peer_query_is_stocks_ordered_by_cap_with_limit(requests):
    df = _Client().get_ticker_metadata(subsector_etf="PBW", limit=5)
    params = [p for t, p in requests if t == "symbols"][0]
    assert params["asset_type"] == "eq.stock"
    assert params["ticker"] == "not.like.*#*"
    expected = sorted(
        (r["ticker"] for r in SYMBOLS if r["subsector_etf"] == "PBW" and CAP_BY_TICKER[r["ticker"]] is not None),
        key=lambda t: -CAP_BY_TICKER[t],
    )[:5]
    assert df["ticker"].tolist() == expected


def test_null_caps_sort_last(requests):
    rows = _Client().get_ticker_metadata(sector_etf="XLU", limit=500, as_dataframe=False)
    assert len(rows) == len(SYMBOLS)
    caps = [r["market_cap"] for r in rows]
    n_null = sum(c is None for c in caps)
    assert n_null == 2
    assert all(c is None for c in caps[-n_null:])
    present = caps[:-n_null]
    assert present == sorted(present, reverse=True)


def test_symbol_and_order_columns(requests):
    rows = _Client().get_ticker_metadata(
        subsector_etf="FIW", columns="ticker,symbol", order="ticker.asc", as_dataframe=False
    )
    assert [r["ticker"] for r in rows] == sorted(r["ticker"] for r in SYMBOLS if r["subsector_etf"] == "FIW")
    assert all(set(r) == {"ticker", "symbol"} for r in rows)
    # No market cap requested or ordered on: no second read.
    assert [t for t, _ in requests] == ["symbols"]


def test_unsupported_column_raises(requests):
    with pytest.raises(ValueError, match="unsupported columns"):
        _Client().get_ticker_metadata(ticker="AEE", columns="ticker,dollar_volume")


def test_peer_group_cap_weights_from_registry(requests):
    pg = PeerGroupProxy.from_ticker(_Client(), "AWK")
    assert pg.group_by == "subsector_etf"
    assert pg.sector_etf == BY_TICKER["AWK"]["subsector_etf"]
    assert "AWK" not in pg.peer_tickers
    assert pg.weight_source == "market_cap"
    assert abs(sum(pg.weights.values()) - 1.0) < 1e-9
    peers = [
        r["ticker"]
        for r in SYMBOLS
        if r["subsector_etf"] == pg.sector_etf and r["ticker"] != "AWK" and CAP_BY_TICKER[r["ticker"]]
    ]
    total = sum(CAP_BY_TICKER[t] for t in peers)
    for t in peers:
        assert pg.weights[t] == pytest.approx(CAP_BY_TICKER[t] / total)


def test_bksy_ppa_peer_group_excludes_registry_placeholders(requests):
    pg = PeerGroupProxy.from_ticker(_Client(), "BKSY")
    assert pg.group_by == "subsector_etf"
    assert pg.sector_etf == "PPA"
    assert pg.n_peers == 3
    assert all("#" not in ticker for ticker in pg.peer_tickers)


def test_peer_group_broadens_to_sector(requests):
    # FIW has 7 stocks: 6 peers < min_peers=10, so the sector ETF is used.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        pg = PeerGroupProxy.from_ticker(_Client(), "AWK", min_peers=10)
    assert pg.group_by == "sector_etf"
    assert pg.sector_etf == "XLU"
    assert pg.n_peers == 50  # max_peers + 1 rows, target excluded


def test_peer_group_missing_ticker_message(requests):
    with pytest.raises(ValueError, match="not found in the symbols registry"):
        PeerGroupProxy.from_ticker(_Client(), "NOPE")
