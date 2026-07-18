"""Public SDK enrichment + identity-fallback tests (MASTER_BACKLOG P.1 + P.2).

P.1 — render-svc and other public-SDK consumers used to render raw FIGI /
symbol IDs (e.g. ``BW-FIGI-BBG000B9XRY4``) instead of tickers because the
Supabase ticker-enrichment helper lived in BWMACRO (a private renderer
wrapper), not in the SDK that render-svc calls. The fix moves the
enricher into the public SDK and chains it by default.

P.2 — ``_fund_identity()`` used to return ``{}`` silently when local
``funds.json`` wasn't on disk (Cloud Run case). The fix adds a Supabase
``public.funds`` fallback so identity resolves from real data when the
local file path doesn't resolve.

Both paths **soft-fail** when Supabase credentials aren't wired — pip
consumers and offline CI builds keep working; the holdings just aren't
enriched and identity returns ``{}``.
"""

from __future__ import annotations

import pytest

from riskmodels.snapshots import _fund_data
from riskmodels.snapshots._fund_data import (
    FundData,
    FundHolding,
    _fund_identity,
    _fund_identity_from_supabase,
    _resolve_holdings_metadata,
    _resolve_l3_decomposition,
    _supabase_creds,
    _supabase_query,
    enrich_fund_data_with_supabase,
)


# ---------------------------------------------------------------------------
# Supabase credential resolution
# ---------------------------------------------------------------------------


def test_supabase_creds_returns_none_when_both_unset(monkeypatch):
    for var in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    assert _supabase_creds() is None


def test_supabase_creds_prefers_server_style(monkeypatch):
    """SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY takes precedence when both
    conventions are present."""
    monkeypatch.setenv("SUPABASE_URL", "https://server.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-key")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://anon.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    creds = _supabase_creds()
    assert creds == ("https://server.supabase.co", "server-key")


def test_supabase_creds_falls_back_to_next_public(monkeypatch):
    """When only the Next.js-style env vars are set, those are used."""
    for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co/")  # trailing slash
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", '"quoted-key"')  # quotes
    creds = _supabase_creds()
    # Trailing slash stripped; quotes stripped.
    assert creds == ("https://x.supabase.co", "quoted-key")


def test_supabase_query_returns_empty_when_no_creds(monkeypatch):
    """Soft-fail: when credentials missing, queries return [] (not raise)."""
    monkeypatch.setattr(_fund_data, "_supabase_creds", lambda: None)
    assert _supabase_query("anything", {}) == []


def test_supabase_query_soft_fails_on_httpx_exception(monkeypatch):
    """Network error / HTTP error → [], not raise."""
    monkeypatch.setattr(
        _fund_data, "_supabase_creds", lambda: ("https://x", "k")
    )

    class _FakeHttpx:
        @staticmethod
        def get(*_args, **_kwargs):
            raise RuntimeError("network down")

    monkeypatch.setitem(__import__("sys").modules, "httpx", _FakeHttpx)
    assert _supabase_query("funds", {}) == []


# ---------------------------------------------------------------------------
# Identity fallback chain (P.2)
# ---------------------------------------------------------------------------


def test_fund_identity_prefers_local_funds_json(monkeypatch, tmp_path):
    """When local funds.json exists, it wins — Supabase fallback is NOT
    queried (preserves laptop-developer behavior)."""
    funds_json = tmp_path / "funds.json"
    funds_json.write_text(
        '[{"bw_fund_id": "BW-FUND-TEST", "ticker": "TEST", "fund_name": "Local Test Fund"}]'
    )
    monkeypatch.setattr(
        _fund_data, "_funds_latest_path", lambda: tmp_path / "funds_latest.json"
    )

    sb_called = {"n": 0}

    def _spy(_id):
        sb_called["n"] += 1
        return {}

    monkeypatch.setattr(_fund_data, "_fund_identity_from_supabase", _spy)

    row = _fund_identity("BW-FUND-TEST")
    assert row["ticker"] == "TEST"
    assert row["fund_name"] == "Local Test Fund"
    assert sb_called["n"] == 0  # Supabase NOT consulted


def test_fund_identity_falls_back_to_supabase_when_funds_json_missing(
    monkeypatch, tmp_path
):
    """Cloud Run case: funds.json doesn't exist → Supabase ``public.funds``
    answers."""
    monkeypatch.setattr(
        _fund_data, "_funds_latest_path", lambda: tmp_path / "funds_latest.json"
    )
    # funds.json (sibling) does NOT exist on this tmp_path.

    monkeypatch.setattr(
        _fund_data,
        "_fund_identity_from_supabase",
        lambda bw: (
            {
                "bw_fund_id": bw,
                "ticker": "AGTHX",
                "fund_name": "American Growth Fund",
                "equity_style_9box": "Large Growth",
            }
            if bw == "BW-FUND-S000004563"
            else {}
        ),
    )

    row = _fund_identity("BW-FUND-S000004563")
    assert row["ticker"] == "AGTHX"
    assert row["fund_name"] == "American Growth Fund"
    assert row["equity_style_9box"] == "Large Growth"


def test_fund_identity_returns_empty_when_neither_source_has_fund(
    monkeypatch, tmp_path
):
    """All sources empty → still ``{}`` (the existing contract is preserved)."""
    monkeypatch.setattr(
        _fund_data, "_funds_latest_path", lambda: tmp_path / "funds_latest.json"
    )
    monkeypatch.setattr(_fund_data, "_fund_identity_from_supabase", lambda _id: {})
    assert _fund_identity("BW-FUND-UNKNOWN") == {}


def test_fund_identity_from_supabase_queries_public_funds(monkeypatch):
    """Verifies the actual ``public.funds`` table is queried with the
    right filter + select clause."""
    captured: dict[str, Any] = {}  # noqa: F821 (Any from typing in source)

    def _fake_query(path, params):
        captured["path"] = path
        captured["params"] = params
        return [
            {
                "bw_fund_id": "BW-FUND-S000004563",
                "ticker": "AGTHX",
                "fund_name": "American Growth Fund",
                "equity_style_9box": "Large Growth",
                "latest_report_date": "2025-11-30",
                "latest_total_adj_mv": 285_000_000_000.0,
            }
        ]

    monkeypatch.setattr(_fund_data, "_supabase_query", _fake_query)
    row = _fund_identity_from_supabase("BW-FUND-S000004563")
    assert captured["path"] == "funds"
    assert captured["params"]["bw_fund_id"] == "eq.BW-FUND-S000004563"
    assert "ticker" in captured["params"]["select"]
    assert "latest_report_date" in captured["params"]["select"]
    assert row["ticker"] == "AGTHX"
    assert row["latest_total_adj_mv"] == 285_000_000_000.0


def test_fund_identity_from_supabase_returns_empty_when_not_found(monkeypatch):
    monkeypatch.setattr(_fund_data, "_supabase_query", lambda _p, _params: [])
    assert _fund_identity_from_supabase("BW-FUND-MISSING") == {}


# ---------------------------------------------------------------------------
# Holdings enrichment (P.1)
# ---------------------------------------------------------------------------


def _fund_with_holdings(
    symbols: list[str] | None = None,
) -> FundData:
    """Minimal FundData carrying holdings keyed by symbol — what render-svc
    sees before enrichment (raw FIGI symbols, no tickers)."""
    if symbols is None:
        symbols = ["BW-FIGI-AAPL", "BW-FIGI-MSFT"]
    return FundData(
        bw_fund_id="BW-FUND-TEST",
        ticker_primary="TEST",
        fund_name="Test Fund",
        teo="2025-11-30",
        equity_style_9box=None,
        aum_usd=None,
        holdings=[
            FundHolding(
                symbol=s,
                ticker=s,  # pre-enrichment: ticker is just the raw symbol
                company_name=s,
                weight=1.0 / len(symbols),
            )
            for s in symbols
        ],
    )


def test_enrich_populates_tickers_from_symbols_table(monkeypatch):
    """The headline P.1 fix: holdings get real tickers from
    Supabase ``symbols``."""
    monkeypatch.setattr(
        _fund_data,
        "_resolve_holdings_metadata",
        lambda syms: {
            "BW-FIGI-AAPL": {
                "symbol": "BW-FIGI-AAPL",
                "ticker": "AAPL",
                "name": "Apple Inc.",
                "sector_etf": "XLK",
                "subsector_etf": "SOXX",
            },
            "BW-FIGI-MSFT": {
                "symbol": "BW-FIGI-MSFT",
                "ticker": "MSFT",
                "name": "Microsoft Corp.",
                "sector_etf": "XLK",
                "subsector_etf": None,
            },
        },
    )
    monkeypatch.setattr(_fund_data, "_resolve_l3_decomposition", lambda _syms: {})

    fd = _fund_with_holdings()
    out = enrich_fund_data_with_supabase(fd)
    assert [h.ticker for h in out.holdings] == ["AAPL", "MSFT"]
    assert out.holdings[0].company_name == "Apple Inc."
    assert out.holdings[0].sector_etf == "XLK"


def test_enrich_populates_l3_shares_from_security_history_latest(monkeypatch):
    monkeypatch.setattr(_fund_data, "_resolve_holdings_metadata", lambda _syms: {})
    monkeypatch.setattr(
        _fund_data,
        "_resolve_l3_decomposition",
        lambda syms: {
            "BW-FIGI-AAPL": {
                "market_share": 0.55,
                "sector_share": 0.20,
                "subsector_share": 0.05,
                "residual_share": 0.20,
            },
        },
    )
    fd = _fund_with_holdings(symbols=["BW-FIGI-AAPL"])
    out = enrich_fund_data_with_supabase(fd)
    h = out.holdings[0]
    assert h.market_share == pytest.approx(0.55)
    assert h.residual_share == pytest.approx(0.20)


def test_resolve_l3_v4_splits_style_from_residual(monkeypatch):
    """FF2 (v4): when l3_style_er / l3_stock_specific_er are present, style_share
    is the style leg and residual_share is the TRUE idio (not the full residual).
    All five legs sum to ~1."""

    def _fake_query(_path, params):
        assert "l3_style_er" in params["select"]
        return [
            {
                "symbol": "BW-FIGI-AAPL",
                "l3_mkt_er": 0.55,
                "l3_sec_er": 0.20,
                "l3_sub_er": 0.05,
                "l3_res_er": 0.20,  # full residual = style + idio
                "l3_style_er": 0.08,
                "l3_stock_specific_er": 0.12,
            }
        ]

    monkeypatch.setattr(_fund_data, "_supabase_query", _fake_query)
    s = _resolve_l3_decomposition(["BW-FIGI-AAPL"])["BW-FIGI-AAPL"]
    assert s["style_share"] == pytest.approx(0.08)
    assert s["residual_share"] == pytest.approx(0.12)  # true idio, not 0.20
    assert sum(v for v in s.values() if v is not None) == pytest.approx(1.0)


def test_resolve_l3_pre_v4_falls_back_to_full_residual(monkeypatch):
    """Pre-migration: the extended select 400s → [] (soft-fail), so the reader
    retries the base 4-leg select and residual_share carries the full residual."""
    calls: list[str] = []

    def _fake_query(_path, params):
        calls.append(params["select"])
        if "l3_style_er" in params["select"]:
            return []  # simulate unknown-column soft-fail
        return [
            {
                "symbol": "BW-FIGI-AAPL",
                "l3_mkt_er": 0.55,
                "l3_sec_er": 0.20,
                "l3_sub_er": 0.05,
                "l3_res_er": 0.20,
            }
        ]

    monkeypatch.setattr(_fund_data, "_supabase_query", _fake_query)
    s = _resolve_l3_decomposition(["BW-FIGI-AAPL"])["BW-FIGI-AAPL"]
    assert s["style_share"] is None
    assert s["residual_share"] == pytest.approx(0.20)  # full residual
    assert len(calls) == 2  # extended tried, then base fallback


def test_resolve_l3_per_row_feature_detect(monkeypatch):
    """A v4 row and a null-style row in the same response are handled
    independently: the null-style row falls back to the full residual."""

    def _fake_query(_path, _params):
        return [
            {
                "symbol": "V4",
                "l3_mkt_er": 0.5, "l3_sec_er": 0.2, "l3_sub_er": 0.1,
                "l3_res_er": 0.2, "l3_style_er": 0.07,
                "l3_stock_specific_er": 0.13,
            },
            {
                "symbol": "PREV4",
                "l3_mkt_er": 0.5, "l3_sec_er": 0.2, "l3_sub_er": 0.1,
                "l3_res_er": 0.2, "l3_style_er": None,
                "l3_stock_specific_er": None,
            },
        ]

    monkeypatch.setattr(_fund_data, "_supabase_query", _fake_query)
    out = _resolve_l3_decomposition(["V4", "PREV4"])
    assert out["V4"]["style_share"] == pytest.approx(0.07)
    assert out["V4"]["residual_share"] == pytest.approx(0.13)
    assert out["PREV4"]["style_share"] is None
    assert out["PREV4"]["residual_share"] == pytest.approx(0.20)


def test_enrich_populates_style_share_from_v4_split(monkeypatch):
    """The per-holding headline: style_share flows through enrich →
    FundHolding, and residual_share becomes the true idio."""
    monkeypatch.setattr(_fund_data, "_resolve_holdings_metadata", lambda _syms: {})
    monkeypatch.setattr(
        _fund_data,
        "_resolve_l3_decomposition",
        lambda syms: {
            "BW-FIGI-AAPL": {
                "market_share": 0.55,
                "sector_share": 0.20,
                "subsector_share": 0.05,
                "style_share": 0.08,
                "residual_share": 0.12,
            },
        },
    )
    fd = _fund_with_holdings(symbols=["BW-FIGI-AAPL"])
    out = enrich_fund_data_with_supabase(fd)
    h = out.holdings[0]
    assert h.style_share == pytest.approx(0.08)
    assert h.residual_share == pytest.approx(0.12)


def test_enrich_soft_fails_when_supabase_unreachable(monkeypatch):
    """No creds → enricher returns the FundData unchanged (no raise)."""
    monkeypatch.setattr(_fund_data, "_supabase_creds", lambda: None)
    fd = _fund_with_holdings()
    out = enrich_fund_data_with_supabase(fd)
    # Tickers unchanged (still the raw symbol strings).
    assert [h.ticker for h in out.holdings] == ["BW-FIGI-AAPL", "BW-FIGI-MSFT"]


def test_enrich_is_noop_on_empty_holdings():
    fd = FundData(
        bw_fund_id="BW-FUND-EMPTY",
        ticker_primary="EMPTY",
        fund_name="Empty",
        teo="2025-11-30",
        equity_style_9box=None,
        aum_usd=None,
        holdings=[],
    )
    out = enrich_fund_data_with_supabase(fd)
    assert out is fd  # identity preserved when there's nothing to enrich


def test_enrich_preserves_existing_values_when_supabase_returns_none(monkeypatch):
    """If Supabase has the symbol but missing some fields, the existing
    FundHolding values survive (None doesn't overwrite real data)."""
    monkeypatch.setattr(
        _fund_data,
        "_resolve_holdings_metadata",
        lambda _syms: {
            "BW-FIGI-AAPL": {"symbol": "BW-FIGI-AAPL", "ticker": "AAPL"}
        },
    )
    monkeypatch.setattr(_fund_data, "_resolve_l3_decomposition", lambda _syms: {})
    # Pre-seed sector_etf via the fund directly.
    fd = FundData(
        bw_fund_id="BW-FUND-TEST",
        ticker_primary="TEST",
        fund_name="Test Fund",
        teo="2025-11-30",
        equity_style_9box=None,
        aum_usd=None,
        holdings=[
            FundHolding(
                symbol="BW-FIGI-AAPL",
                ticker="BW-FIGI-AAPL",
                company_name="BW-FIGI-AAPL",
                weight=1.0,
                sector_etf="PRE-EXISTING",
            )
        ],
    )
    out = enrich_fund_data_with_supabase(fd)
    h = out.holdings[0]
    assert h.ticker == "AAPL"
    # sector_etf wasn't in the Supabase row → existing value preserved.
    assert h.sector_etf == "PRE-EXISTING"


# ---------------------------------------------------------------------------
# get_data_for_f1 default-enrich behavior
# ---------------------------------------------------------------------------


def test_get_data_for_f1_default_enriches(monkeypatch):
    """The headline contract change: render-svc now gets enriched
    FundData by default."""
    captured = {"called": False}

    def _spy_enrich(fd):
        captured["called"] = True
        return fd

    monkeypatch.setattr(_fund_data, "enrich_fund_data_with_supabase", _spy_enrich)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})
    # All zarr stores soft-fail (no real data needed for the enrich-default test).
    monkeypatch.setattr(
        _fund_data,
        "_open_fund_zarr",
        lambda *_a, **_kw: (_ for _ in ()).throw(FileNotFoundError("test")),
    )
    _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert captured["called"] is True


def test_get_data_for_f1_enrich_false_skips_supabase(monkeypatch):
    """Opt-out path: ``enrich=False`` skips the Supabase round-trip
    entirely (useful for tests + offline CI)."""
    captured = {"called": False}

    def _spy_enrich(fd):
        captured["called"] = True
        return fd

    monkeypatch.setattr(_fund_data, "enrich_fund_data_with_supabase", _spy_enrich)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})
    monkeypatch.setattr(
        _fund_data,
        "_open_fund_zarr",
        lambda *_a, **_kw: (_ for _ in ()).throw(FileNotFoundError("test")),
    )
    _fund_data.get_data_for_f1("BW-FUND-TEST", enrich=False)
    assert captured["called"] is False
