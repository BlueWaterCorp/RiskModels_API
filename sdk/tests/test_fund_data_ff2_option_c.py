"""``get_data_for_f1`` — F.23 Option C / Option A Style gate.

When monthly ``ds_portfolio`` carries a material FF2 Style leg but
``ds_fund_returns_daily`` is still the pre-split 4-leg cube (no
``style_return``), Section I must keep the monthly cascade instead of
clearing ``cum_style``. When daily *does* expose ``style_return``, the
5-leg daily cascade wins.
"""

from __future__ import annotations

import numpy as np
import pytest

from riskmodels.snapshots import _fund_data


class _FakeArr:
    def __init__(self, data: np.ndarray, attrs: dict | None = None) -> None:
        self._data = data
        self.attrs = attrs or {}

    def __getitem__(self, idx):
        return self._data[idx]


class _FakeZarrGroup:
    def __init__(self, arrays: dict[str, _FakeArr], attrs: dict | None = None) -> None:
        self._arrays = arrays
        self.attrs = attrs or {}

    def __getitem__(self, key: str) -> _FakeArr:
        return self._arrays[key]

    def __contains__(self, key: str) -> bool:
        return key in self._arrays

    def array_keys(self):
        return list(self._arrays.keys())


def _portfolio_v4_with_style(
    teos: list[str],
    *,
    mkt: float = 0.01,
    sec: float = 0.002,
    sub: float = 0.001,
    style: float = 0.004,
    idio: float = 0.003,
) -> _FakeZarrGroup:
    """Multi-quarter v4 portfolio with a non-zero Style strip."""
    epoch = np.datetime64("1970-01-01")
    secs = [
        int((np.datetime64(t) - epoch) / np.timedelta64(1, "s")) for t in teos
    ]
    n = len(teos)
    return _FakeZarrGroup(
        {
            "weight_sum": _FakeArr(np.ones(n, dtype=float)),
            "portfolio_market_return": _FakeArr(np.full(n, mkt, dtype=float)),
            "portfolio_sector_return": _FakeArr(np.full(n, sec, dtype=float)),
            "portfolio_subsector_return": _FakeArr(np.full(n, sub, dtype=float)),
            "portfolio_style_return": _FakeArr(np.full(n, style, dtype=float)),
            "portfolio_idiosyncratic_return": _FakeArr(np.full(n, idio, dtype=float)),
            "teo": _FakeArr(np.array(secs, dtype=np.int64)),
        },
        attrs={
            "adjusted_l1_market_er": 0.80,
            "adjusted_l2_sector_er": 0.08,
            "adjusted_l3_subsector_er": 0.04,
            "adjusted_style_er": 0.02,
            "adjusted_l3_residual_er": 0.06,
            "adjusted_total_vol_ann": 0.15,
        },
    )


def _nav_months(teos: list[str], ret: float = 0.01) -> _FakeZarrGroup:
    return _FakeZarrGroup(
        {
            "teo": _FakeArr(np.array(teos, dtype="datetime64[D]")),
            "nav_return_monthly": _FakeArr(np.full(len(teos), ret, dtype=float)),
        },
    )


def _ph_aum(teo_str: str = "2025-11-30") -> _FakeZarrGroup:
    epoch = np.datetime64("1970-01-01")
    days = int((np.datetime64(teo_str) - epoch) / np.timedelta64(1, "D"))
    return _FakeZarrGroup(
        {
            "aum_erm3": _FakeArr(np.array([1_000_000.0], dtype=float)),
            "adj_mv": _FakeArr(np.array([[500_000.0], [500_000.0]], dtype=float)),
            "symbol": _FakeArr(np.array(["AAPL", "MSFT"], dtype=object)),
            "teo": _FakeArr(
                np.array([days], dtype=np.int64),
                attrs={"units": "days since 1970-01-01"},
            ),
        },
    )


def _daily_4leg(n_days: int = 5, start: str = "2025-01-02") -> _FakeZarrGroup:
    """Pre-split daily cube — no ``style_return``."""
    teos = np.arange(
        np.datetime64(start),
        np.datetime64(start) + n_days,
        dtype="datetime64[D]",
    )
    ones = np.ones((n_days, 1), dtype=float)
    return _FakeZarrGroup(
        {
            "lag_basis": _FakeArr(np.array(["report_date"], dtype=object)),
            "teo": _FakeArr(teos),
            "gross_return": _FakeArr(0.001 * ones),
            "l1_market": _FakeArr(0.0006 * ones),
            "l2_sector": _FakeArr(0.0002 * ones),
            "l3_subsector": _FakeArr(0.0001 * ones),
            # Combined style+idio (pre-split semantics).
            "l3_residual": _FakeArr(0.0001 * ones),
        },
    )


def _daily_5leg(n_days: int = 5, start: str = "2025-01-02") -> _FakeZarrGroup:
    """Post-Option-A daily cube with ``style_return``."""
    teos = np.arange(
        np.datetime64(start),
        np.datetime64(start) + n_days,
        dtype="datetime64[D]",
    )
    ones = np.ones((n_days, 1), dtype=float)
    return _FakeZarrGroup(
        {
            "lag_basis": _FakeArr(np.array(["report_date"], dtype=object)),
            "teo": _FakeArr(teos),
            "gross_return": _FakeArr(0.001 * ones),
            "l1_market": _FakeArr(0.0005 * ones),
            "l2_sector": _FakeArr(0.0002 * ones),
            "l3_subsector": _FakeArr(0.0001 * ones),
            "style_return": _FakeArr(0.00015 * ones),
            "l3_residual": _FakeArr(0.00005 * ones),
        },
    )


def _install(
    monkeypatch: pytest.MonkeyPatch,
    *,
    portfolio: _FakeZarrGroup,
    daily: _FakeZarrGroup | None,
    nav_teos: list[str] | None = None,
) -> None:
    if nav_teos is None:
        nav_teos = [
            "2021-01-31", "2021-02-28", "2021-03-31", "2021-04-30",
            "2021-05-31", "2021-06-30", "2021-07-31", "2021-08-31",
            "2021-09-30", "2021-10-31", "2021-11-30", "2021-12-31",
            "2022-01-31", "2022-02-28", "2022-03-31", "2022-04-30",
            "2022-05-31", "2022-06-30", "2022-07-31", "2022-08-31",
            "2022-09-30", "2022-10-31", "2022-11-30", "2022-12-31",
            "2023-01-31", "2023-02-28", "2023-03-31", "2023-04-30",
            "2023-05-31", "2023-06-30", "2023-07-31", "2023-08-31",
            "2023-09-30", "2023-10-31", "2023-11-30", "2023-12-31",
            "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30",
            "2024-05-31", "2024-06-30", "2024-07-31", "2024-08-31",
            "2024-09-30", "2024-10-31", "2024-11-30", "2024-12-31",
            "2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30",
            "2025-05-31", "2025-06-30", "2025-07-31", "2025-08-31",
            "2025-09-30", "2025-10-31", "2025-11-30",
        ]
    ph = _ph_aum(nav_teos[-1])
    nav = _nav_months(nav_teos)
    stores = {
        "ds_ph.zarr": ph,
        "ds_nav.zarr": nav,
        "ds_portfolio.zarr": portfolio,
        "ds_fund_returns_daily.zarr": daily,
        "ds_hr.zarr": None,
    }

    def _fake_open(_bw_fund_id: str, store: str):
        val = stores.get(store)
        if val is None:
            raise FileNotFoundError(store)
        return val

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})


def test_option_c_keeps_monthly_style_when_daily_lacks_style_return(monkeypatch):
    """4-leg daily must not wipe material monthly Style (Option C)."""
    teos = [
        "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
        "2025-03-31", "2025-06-30", "2025-09-30", "2025-11-30",
    ]
    _install(
        monkeypatch,
        portfolio=_portfolio_v4_with_style(teos, style=0.005),
        daily=_daily_4leg(),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-OPTION-C", enrich=False)

    assert fd.cum_style, "Option C must retain monthly cum_style"
    assert abs(float(fd.cum_style[-1][1])) > 1e-6
    assert "style" in fd.layer_attribution
    assert abs(float(fd.layer_attribution["style"])) > 1e-6
    # Monthly cascade is sparse vs daily; Option C keeps monthly dates.
    assert len(fd.cum_style) < 50


def test_option_a_daily_style_return_wins_over_monthly(monkeypatch):
    """When daily exposes ``style_return``, 5-leg daily overrides monthly."""
    teos = [
        "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
        "2025-03-31", "2025-06-30", "2025-09-30", "2025-11-30",
    ]
    _install(
        monkeypatch,
        portfolio=_portfolio_v4_with_style(teos, style=0.005),
        daily=_daily_5leg(n_days=8),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-OPTION-A", enrich=False)

    assert fd.cum_style
    assert "style" in fd.layer_attribution
    # One point per date; the first close is the zero anchor.
    assert len(fd.cum_nav_return) == 8
    assert len(fd.cum_style) == 8


def test_four_leg_daily_clears_style_when_monthly_style_is_zero(monkeypatch):
    """Zero-filled monthly Style must not block denser 4-leg daily."""
    teos = ["2025-06-30", "2025-09-30", "2025-11-30"]
    portfolio = _portfolio_v4_with_style(teos, style=0.0)
    portfolio.attrs = {
        "adjusted_l1_market_er": 0.85,
        "adjusted_l2_sector_er": 0.05,
        "adjusted_l3_subsector_er": 0.04,
        "adjusted_l3_residual_er": 0.06,
        "adjusted_total_vol_ann": 0.15,
        # no adjusted_style_er — pre-v4 / zero Style ER
    }
    _install(
        monkeypatch,
        portfolio=portfolio,
        daily=_daily_4leg(n_days=6),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-PRE-V4", enrich=False)

    assert fd.cum_style == []
    assert "style" not in fd.layer_attribution
    assert len(fd.cum_nav_return) == 6  # daily override, unique close dates


@pytest.mark.parametrize("daily_factory", [_daily_4leg, _daily_5leg])
def test_daily_cascade_starts_at_first_close_once_and_reconciles(monkeypatch, daily_factory):
    daily = daily_factory(n_days=5)
    # A very different first interval makes accidental inclusion detectable.
    daily._arrays["gross_return"]._data[0, 0] = 0.25
    portfolio = _portfolio_v4_with_style(
        ["2025-06-30", "2025-09-30", "2025-11-30"], style=0.0,
    )
    portfolio.attrs["adjusted_style_er"] = 0.0
    _install(monkeypatch, portfolio=portfolio, daily=daily)
    fd = _fund_data.get_data_for_f1("BW-FUND-BASELINE", enrich=False)
    for series in (fd.cum_nav_return, fd.cum_l1_market, fd.cum_l2_sector,
                   fd.cum_l3_subsector, fd.cum_l3_residual, fd.cum_style):
        if not series:
            continue
        assert series[0] == ("2025-01-02", 0.0)
        assert len(series) == 5
        assert all(a[0] < b[0] for a, b in zip(series, series[1:]))
    gross = fd.cum_nav_return[-1][1]
    assert gross == pytest.approx(1.001 ** 4 - 1.0)
    assert fd.cum_nav_return[1][1] == pytest.approx(0.001)
    style = fd.cum_style[-1][1] if fd.cum_style else 0.0
    assert fd.cum_l3_subsector[-1][1] + style + fd.cum_l3_residual[-1][1] == pytest.approx(gross)
    assert fd.layer_attribution["residual"] * gross == pytest.approx(fd.cum_l3_residual[-1][1])


def test_monthly_cascade_uses_common_unique_close_anchor(monkeypatch):
    teos = ["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]
    _install(monkeypatch, portfolio=_portfolio_v4_with_style(teos), daily=None, nav_teos=teos)
    fd = _fund_data.get_data_for_f1("BW-FUND-MONTHLY-BASELINE", enrich=False)
    for series in (fd.cum_nav_return, fd.cum_l1_market, fd.cum_l2_sector,
                   fd.cum_l3_subsector, fd.cum_l3_residual, fd.cum_style):
        assert series[0] == (teos[0], 0.0)
        assert [d for d, _ in series] == teos
    gross = fd.cum_nav_return[-1][1]
    assert gross == pytest.approx(1.01 ** 3 - 1.0)
    assert fd.cum_l3_subsector[-1][1] + fd.cum_style[-1][1] + fd.cum_l3_residual[-1][1] == pytest.approx(gross)


def test_nav_only_starts_at_first_actual_close(monkeypatch):
    nav = _nav_months(["2025-01-31", "2025-02-28", "2025-03-31"])
    nav._arrays["nav_return_monthly"]._data[0] = -1.0
    def fake_open(_fund_id, store):
        if store == "ds_nav.zarr":
            return nav
        raise FileNotFoundError(store)
    monkeypatch.setattr(_fund_data, "_open_fund_zarr", fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})
    fd = _fund_data.get_data_for_f1("BW-FUND-NAV-BASELINE", enrich=False)
    assert fd.cum_nav_return[0] == ("2025-01-31", 0.0)
    assert fd.cum_nav_return[-1][1] == pytest.approx(1.01 ** 2 - 1.0)
