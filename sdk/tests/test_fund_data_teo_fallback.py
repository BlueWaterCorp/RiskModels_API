"""``get_data_for_f1`` — ``teo_str`` fallback chain tests.

Production gap (2026-05-16): when ``ds_ph.zarr`` is missing or thin for
a given ``bw_fund_id``, the loader's only other source for ``teo_str``
was ``_fund_identity()`` (which reads ``funds.json`` from a path that
doesn't exist in the render-svc Cloud Run container unless
``FUNDS_DAG_DATA_ROOT`` is explicitly wired). Both sources can silently
yield ``""`` → render-svc returns ``no resolved as_of`` to the caller
with no diagnostic of which gap was hit.

This fix extends ``get_data_for_f1`` with a fallback chain:

  1. ``_fund_identity().latest_report_date``  (existing — env-dependent)
  2. ``ds_ph.zarr`` latest valid AUM period   (existing — primary)
  3. ``ds_nav.zarr`` last finite NAV month    (new fallback)
  4. ``ds_portfolio.zarr`` last populated qtr (new last-resort fallback)

These tests exercise the chain by mocking ``_open_fund_zarr`` so each
store can be independently present / absent / thin.
"""

from __future__ import annotations

import numpy as np
import pytest

from riskmodels.snapshots import _fund_data


# ---------------------------------------------------------------------------
# Fake zarr group helpers — minimal surface to satisfy get_data_for_f1.
# ---------------------------------------------------------------------------


class _FakeArr:
    """Numpy-array wrapper that also exposes a `.attrs` dict like zarr."""

    def __init__(self, data: np.ndarray, attrs: dict | None = None) -> None:
        self._data = data
        self.attrs = attrs or {}

    def __getitem__(self, idx):
        return self._data[idx]


class _FakeZarrGroup:
    """Dict-like + .array_keys() + .attrs to mimic a zarr group."""

    def __init__(self, arrays: dict[str, _FakeArr], attrs: dict | None = None) -> None:
        self._arrays = arrays
        self.attrs = attrs or {}

    def __getitem__(self, key: str) -> _FakeArr:
        return self._arrays[key]

    def __contains__(self, key: str) -> bool:
        return key in self._arrays

    def array_keys(self):
        return list(self._arrays.keys())


def _ph_with_valid_aum(teo_str: str = "2025-11-30") -> _FakeZarrGroup:
    """ds_ph.zarr with one valid AUM period at teo_str (days-since-epoch encoded)."""
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


def _ph_with_no_valid_aum() -> _FakeZarrGroup:
    """ds_ph.zarr that opens cleanly but has zero finite AUM periods —
    teo_str CANNOT be set from this store."""
    return _FakeZarrGroup(
        {
            "aum_erm3": _FakeArr(np.array([np.nan, 0.0], dtype=float)),
            "adj_mv": _FakeArr(np.zeros((1, 2), dtype=float)),
            "symbol": _FakeArr(np.array(["AAPL"], dtype=object)),
            "teo": _FakeArr(np.array([0, 0], dtype=np.int64)),
        },
    )


def _nav_with_teos(teos: list[str], rets: list[float] | None = None) -> _FakeZarrGroup:
    """ds_nav.zarr — sequence of monthly teos + NAV returns."""
    if rets is None:
        rets = [0.01] * len(teos)
    teo_arr = np.array(teos, dtype="datetime64[D]")
    return _FakeZarrGroup(
        {
            "teo": _FakeArr(teo_arr),
            "nav_return_monthly": _FakeArr(np.array(rets, dtype=float)),
        },
    )


def _portfolio_with_one_quarter(teo_str: str = "2025-09-30") -> _FakeZarrGroup:
    """ds_portfolio.zarr — one populated quarter at teo_str."""
    epoch = np.datetime64("1970-01-01")
    secs = int((np.datetime64(teo_str) - epoch) / np.timedelta64(1, "s"))
    return _FakeZarrGroup(
        {
            "weight_sum": _FakeArr(np.array([1.0], dtype=float)),
            "portfolio_market_return": _FakeArr(np.array([0.01], dtype=float)),
            "portfolio_sector_return": _FakeArr(np.array([0.002], dtype=float)),
            "portfolio_subsector_return": _FakeArr(np.array([0.001], dtype=float)),
            "portfolio_idiosyncratic_return": _FakeArr(np.array([0.003], dtype=float)),
            "teo": _FakeArr(np.array([secs], dtype=np.int64)),
        },
    )


def _install_zarr_stores(
    monkeypatch: pytest.MonkeyPatch,
    *,
    ph: _FakeZarrGroup | None,
    nav: _FakeZarrGroup | None = None,
    portfolio: _FakeZarrGroup | None = None,
    hr: _FakeZarrGroup | None = None,
) -> None:
    """Patch ``_open_fund_zarr`` to return the supplied stores by name.
    A ``None`` store maps to a soft FileNotFoundError (the production
    soft-fail signal)."""

    def _fake_open(bw_fund_id: str, store: str):
        m = {
            "ds_ph.zarr": ph,
            "ds_nav.zarr": nav,
            "ds_portfolio.zarr": portfolio,
            "ds_hr.zarr": hr,
        }
        val = m.get(store)
        if val is None:
            raise FileNotFoundError(store)
        return val

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)


def _force_identity_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Block the env-dependent identity seed so we test pure zarr paths."""
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})


# ---------------------------------------------------------------------------
# Tests — primary path first, then each fallback rung, then total failure.
# ---------------------------------------------------------------------------


def test_ph_provides_teo_primary_path(monkeypatch):
    """Baseline: ds_ph.zarr has a valid AUM period → teo_str comes from
    ds_ph (existing behavior, unchanged)."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=_ph_with_valid_aum("2025-11-30"),
        nav=_nav_with_teos(["2024-12-31", "2025-01-31"]),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-11-30"


def test_nav_fallback_when_ds_ph_missing(monkeypatch):
    """ds_ph.zarr missing entirely → teo_str falls back to last finite
    NAV teo from ds_nav.zarr."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=None,  # missing
        nav=_nav_with_teos(["2024-12-31", "2025-01-31", "2025-02-28"]),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-02-28"


def test_nav_fallback_when_ds_ph_thin(monkeypatch):
    """ds_ph.zarr opens but has no valid AUM periods → ds_nav fallback."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=_ph_with_no_valid_aum(),
        nav=_nav_with_teos(["2025-03-31"]),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-03-31"


def test_nav_fallback_skips_non_finite_returns(monkeypatch):
    """Only finite NAV teos count — a trailing NaN return is excluded
    from the fallback candidate set."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=None,
        nav=_nav_with_teos(
            ["2025-01-31", "2025-02-28", "2025-03-31"],
            rets=[0.01, 0.02, float("nan")],
        ),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-02-28"


def test_portfolio_fallback_when_ph_and_nav_missing(monkeypatch):
    """Both ds_ph + ds_nav missing → ds_portfolio's last populated
    quarter serves as the last-resort teo source."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=None,
        nav=None,
        portfolio=_portfolio_with_one_quarter("2025-09-30"),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-09-30"


def test_teo_remains_empty_when_all_sources_missing(monkeypatch):
    """All three zarr stores missing + no identity seed → teo_str
    stays "" and the caller (render-svc) surfaces the gap explicitly."""
    _force_identity_empty(monkeypatch)
    _install_zarr_stores(
        monkeypatch,
        ph=None,
        nav=None,
        portfolio=None,
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == ""


def test_identity_seed_still_takes_precedence_over_fallbacks(monkeypatch):
    """If _fund_identity supplies latest_report_date, it remains the
    starting value of teo_str. The ds_ph path can override it; if
    ds_ph is missing, the identity-seeded teo_str survives untouched
    (fallback only runs when teo_str is still empty)."""

    monkeypatch.setattr(
        _fund_data,
        "_fund_identity",
        lambda _id: {"latest_report_date": "2025-06-30"},
    )
    _install_zarr_stores(
        monkeypatch,
        ph=None,
        nav=_nav_with_teos(["2025-02-28"]),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    # Identity seed wins — fallback chain only fills "" gaps.
    assert fd.teo == "2025-06-30"


def test_ph_overrides_identity_seed_when_both_present(monkeypatch):
    """ds_ph.zarr's actual holdings teo is more authoritative than
    funds.json's cached latest_report_date — preserves existing
    behavior (the ds_ph block unconditionally overwrites teo_str when
    a valid AUM period exists)."""

    monkeypatch.setattr(
        _fund_data,
        "_fund_identity",
        lambda _id: {"latest_report_date": "2025-06-30"},
    )
    _install_zarr_stores(
        monkeypatch,
        ph=_ph_with_valid_aum("2025-11-30"),
    )
    fd = _fund_data.get_data_for_f1("BW-FUND-TEST")
    assert fd.teo == "2025-11-30"  # ds_ph wins
