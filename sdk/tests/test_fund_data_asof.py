"""G.44 — historical ``as_of`` selection in ``get_data_for_f1``.

Decision of record (ADR 2026-08-01): reality mode, ``report_date`` basis,
"latest stored period ≤ as_of" per store, disclosed via an
``as_of_basis`` echo. A date predating all history raises
``FundAsOfUnavailableError`` — never an empty payload or a silent
fall-forward to the latest row (house PIT convention).

Honest degradation (decided in the dispatch): a genuinely historical read
skips the CURRENT-model per-holding share overlay, omits the latest-only
Section III fit stats, and marks the payload via
``historical_degradations``. An ``as_of`` that resolves to the latest
period (nothing truncated anywhere) serves the full payload.
"""

from __future__ import annotations

import numpy as np
import pytest

from riskmodels.snapshots import _fund_data
from riskmodels.snapshots._fund_data import (
    FundAsOfUnavailableError,
    FundData,
    FundHolding,
    enrich_fund_data_with_supabase,
    get_data_for_f1,
)


# ---------------------------------------------------------------------------
# Fake zarr stores (same _FakeArr pattern as test_fund_data_ragged_daily)
# ---------------------------------------------------------------------------


class _FakeArr:
    def __init__(self, data, attrs=None):
        self._d = np.asarray(data) if not isinstance(data, np.ndarray) else data
        self.attrs = attrs or {}

    def __getitem__(self, idx):
        return self._d[idx]


class _FakeStore:
    def __init__(self, arrays: dict, attrs: dict | None = None):
        self._arrays = arrays
        self.attrs = attrs or {}

    def array_keys(self):
        return list(self._arrays)

    def __contains__(self, key):
        return key in self._arrays

    def __getitem__(self, key):
        return self._arrays[key]


def _days(iso: str) -> int:
    return int(np.datetime64(iso).astype("datetime64[D]").astype(np.int64))


_CF_DAYS = {"units": "days since 1970-01-01"}


def _teo_arr(dates: list[str]) -> _FakeArr:
    return _FakeArr(
        np.array([_days(d) for d in dates], dtype=np.int64), attrs=_CF_DAYS
    )


# Three holding periods; the middle one is the historical target.
_PH_TEOS = ["2023-12-31", "2024-06-30", "2026-06-30"]
_NAV_TEOS = ["2024-04-30", "2024-05-31", "2024-06-30", "2024-07-31", "2026-06-30"]
_PT_TEOS = ["2024-03-31", "2024-06-30", "2026-06-30"]
_HR_TEOS = ["2024-06-30", "2026-06-30"]


def _make_stores() -> dict[str, _FakeStore]:
    ph = _FakeStore(
        {
            "teo": _teo_arr(_PH_TEOS),
            "aum_erm3": _FakeArr(np.array([1e9, 2e9, 3e9])),
            # (symbol, period)
            "adj_mv": _FakeArr(
                np.array(
                    [
                        [500e6, 1000e6, 1500e6],
                        [300e6, 600e6, 900e6],
                        [200e6, 400e6, 600e6],
                    ]
                )
            ),
            "symbol": _FakeArr(np.array(["S_A", "S_B", "S_C"], dtype=object)),
        }
    )
    nv = _FakeStore(
        {
            "teo": _teo_arr(_NAV_TEOS),
            "nav_return_monthly": _FakeArr(
                np.array([0.01, 0.02, -0.01, 0.03, 0.01])
            ),
        }
    )
    hr = _FakeStore(
        {
            "teo": _teo_arr(_HR_TEOS),
            "symbol": _FakeArr(np.array(["SPY", "XLK"], dtype=object)),
            "L1_HR": _FakeArr(np.array([[1.0, 0.2], [1.1, 0.3]])),
            "L2_HR": _FakeArr(np.array([[0.5, 0.4], [0.6, 0.7]])),
            "L3_HR": _FakeArr(np.array([[0.3, 0.25], [0.35, 0.45]])),
        }
    )
    pt = _FakeStore(
        {
            "teo": _teo_arr(_PT_TEOS),
            "weight_sum": _FakeArr(np.array([1.0, 1.0, 1.0])),
            "portfolio_market_return": _FakeArr(np.array([0.02, 0.01, 0.03])),
            "portfolio_sector_return": _FakeArr(np.array([0.004, 0.002, 0.005])),
            "portfolio_subsector_return": _FakeArr(
                np.array([0.002, 0.001, 0.002])
            ),
            "portfolio_idiosyncratic_return": _FakeArr(
                np.array([0.006, 0.004, 0.008])
            ),
        }
    )
    return {
        "ds_ph.zarr": ph,
        "ds_nav.zarr": nv,
        "ds_hr.zarr": hr,
        "ds_portfolio.zarr": pt,
    }


@pytest.fixture
def fund_zarrs(monkeypatch):
    stores = _make_stores()

    def _fake_open(_bw_fund_id: str, store: str):
        if store in stores:
            return stores[store]
        raise FileNotFoundError(store)

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})
    return stores


# ---------------------------------------------------------------------------
# (a) historical selection per store
# ---------------------------------------------------------------------------


def test_historical_as_of_selects_latest_period_lte_date(fund_zarrs):
    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="2024-06-30")

    # Resolved period = the served row's teo, ≤ the requested date.
    assert fd.teo == "2024-06-30"
    assert fd.as_of_requested == "2024-06-30"
    assert fd.as_of_basis == "report_date"

    # ds_ph: middle period, not the latest one.
    assert fd.aum_usd == pytest.approx(2e9)
    assert fd.holdings[0].weight == pytest.approx(0.5)  # 1000e6 / 2e9

    # ds_nav: truncated at as_of — nothing after the date anywhere.
    assert all(d <= "2024-06-30" for d, _ in fd.cum_nav_return)

    # ds_hr: the ≤-as_of row (row 0), not [-1, :].
    assert fd.hedge_ratios["l1_spy"] == pytest.approx(1.0)

    # ds_portfolio: only periods ≤ as_of feed the layer series.
    assert [t[0] for t in fd.layer_returns_series] == ["2024-03-31", "2024-06-30"]


def test_historical_read_is_marked_and_fit_omitted(fund_zarrs):
    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="2024-06-30")

    assert "fund_fit_section_omitted" in fd.historical_degradations
    assert "holdings_model_share_overlay_skipped" in fd.historical_degradations
    # enrich=False → no registry-label disclosure (labels were not resolved).
    assert "holdings_labels_from_current_registry" not in fd.historical_degradations

    # Section III fit fields all empty on a historical read.
    for f in (
        fd.fit_coverage_mean,
        fd.fit_correlation_monthly,
        fd.fit_delta_5y_pp,
        fd.fit_nav_beta,
    ):
        assert f is None


def test_weekend_or_gap_date_resolves_to_prior_period(fund_zarrs):
    # 2024-09-15 sits between stored periods → latest ≤ rule serves
    # 2024-06-30 (ds_ph) — never a nearest-match beyond the date.
    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="2024-09-15")
    assert fd.teo <= "2024-09-15"
    # teo anchors on the holdings period (same rule as the latest path).
    assert fd.teo == "2024-06-30"
    assert fd.aum_usd == pytest.approx(2e9)  # holdings still from 2024-06-30
    assert all(d <= "2024-09-15" for d, _ in fd.cum_nav_return)


# ---------------------------------------------------------------------------
# (b) pre-history date → explicit error
# ---------------------------------------------------------------------------


def test_pre_history_as_of_raises_specific_error(fund_zarrs):
    with pytest.raises(FundAsOfUnavailableError) as exc:
        get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="1990-01-01")
    assert "1990-01-01" in str(exc.value)
    assert "BW-FUND-ASOF" in str(exc.value)


def test_malformed_as_of_raises_value_error(fund_zarrs):
    with pytest.raises(ValueError):
        get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="last-week")


# ---------------------------------------------------------------------------
# (c) latest path unchanged
# ---------------------------------------------------------------------------


def test_latest_path_unchanged_without_as_of(fund_zarrs):
    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False)

    assert fd.teo == "2026-06-30"
    assert fd.aum_usd == pytest.approx(3e9)
    assert fd.hedge_ratios["l1_spy"] == pytest.approx(1.1)  # [-1, :] row
    assert fd.as_of_requested is None
    assert fd.as_of_basis is None
    assert fd.historical_degradations == []
    assert [t[0] for t in fd.layer_returns_series] == _PT_TEOS


def test_as_of_at_or_beyond_latest_serves_full_payload(fund_zarrs):
    # Nothing is truncated anywhere → not a historical read: the echo is
    # present but no degradation applies (the current-model overlay is
    # the right vintage for the latest period).
    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="2027-01-01")
    assert fd.teo == "2026-06-30"
    assert fd.as_of_requested == "2027-01-01"
    assert fd.as_of_basis == "report_date"
    assert fd.historical_degradations == []
    assert fd.aum_usd == pytest.approx(3e9)


# ---------------------------------------------------------------------------
# daily cube window ends at as_of
# ---------------------------------------------------------------------------


def _add_daily_store(stores: dict, dates: list[str]) -> None:
    n = len(dates)
    gross = 0.001 * (1 + np.arange(n))

    def _col(vals):
        return np.asarray(vals, dtype=float).reshape(-1, 1)

    stores["ds_fund_returns_daily.zarr"] = _FakeStore(
        {
            "lag_basis": _FakeArr(np.array(["report_date"], dtype=object)),
            "teo": _teo_arr(dates),
            "gross_return": _FakeArr(_col(gross)),
            "l1_market": _FakeArr(_col(gross * 0.7)),
            "l2_sector": _FakeArr(_col(gross * 0.1)),
            "l3_subsector": _FakeArr(_col(gross * 0.05)),
            "l3_residual": _FakeArr(_col(gross * 0.15)),
        }
    )


def test_daily_cube_truncates_at_as_of(fund_zarrs):
    dates = [
        "2024-06-25", "2024-06-26", "2024-06-27", "2024-06-28",
        "2024-07-01", "2024-07-02",
    ]
    _add_daily_store(fund_zarrs, dates)

    fd = get_data_for_f1("BW-FUND-ASOF", enrich=False, as_of="2024-06-30")
    # Daily 4-leg override wins Section I; its window must end ≤ as_of.
    assert fd.cum_nav_return[-1][0] == "2024-06-28"
    assert all(d <= "2024-06-30" for d, _ in fd.cum_nav_return)
    for series in (fd.cum_l1_market, fd.cum_l2_sector, fd.cum_l3_subsector,
                   fd.cum_l3_residual):
        assert series[-1][0] == "2024-06-28"


# ---------------------------------------------------------------------------
# enrichment: labels kept, current-model shares skipped
# ---------------------------------------------------------------------------


def _fake_meta(syms):
    return {
        s: {"ticker": f"T{i}", "name": f"Name {i}", "sector_etf": "XLK",
            "subsector_etf": "SMH"}
        for i, s in enumerate(syms)
    }


def test_enrich_include_model_shares_false_keeps_labels_skips_shares(monkeypatch):
    calls = {"l3": 0}
    monkeypatch.setattr(
        _fund_data, "_resolve_holdings_metadata", lambda syms: _fake_meta(syms)
    )

    def _l3(syms):
        calls["l3"] += 1
        return {s: {"market_share": 0.5, "sector_share": 0.2,
                    "subsector_share": 0.1, "style_share": 0.05,
                    "residual_share": 0.15} for s in syms}

    monkeypatch.setattr(_fund_data, "_resolve_l3_decomposition", _l3)

    fd = FundData(
        bw_fund_id="BW-FUND-ASOF", ticker_primary="X", fund_name="X",
        teo="2024-06-30", equity_style_9box=None, aum_usd=None,
        holdings=[FundHolding(symbol="S_A", ticker="S_A", company_name="S_A",
                              weight=0.5)],
    )

    out = enrich_fund_data_with_supabase(fd, include_model_shares=False)
    assert out.holdings[0].ticker == "T0"          # labels resolved
    assert out.holdings[0].sector_etf == "XLK"
    assert out.holdings[0].market_share is None    # shares NOT overlaid
    assert out.holdings[0].residual_share is None
    assert calls["l3"] == 0                        # table never queried

    out2 = enrich_fund_data_with_supabase(fd)      # default keeps overlay
    assert out2.holdings[0].market_share == pytest.approx(0.5)
    assert calls["l3"] == 1


def test_historical_get_data_skips_model_share_overlay(fund_zarrs, monkeypatch):
    monkeypatch.setattr(
        _fund_data, "_resolve_holdings_metadata", lambda syms: _fake_meta(syms)
    )

    def _boom(_syms):
        raise AssertionError(
            "security_history_latest overlay must not run for historical as_of"
        )

    monkeypatch.setattr(_fund_data, "_resolve_l3_decomposition", _boom)

    fd = get_data_for_f1("BW-FUND-ASOF", as_of="2024-06-30")  # enrich=True
    assert fd.holdings[0].ticker == "T0"
    assert fd.holdings[0].market_share is None
    assert "holdings_labels_from_current_registry" in fd.historical_degradations
