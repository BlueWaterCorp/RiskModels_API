"""Ragged daily cube regression test (2026-07-26 incident).

The prod `ds_fund_returns_daily.zarr` for AGTHX drifted: `style_return`
ends 2 days before `teo` / `gross_return` / the L3 strips (its factor
panel stalled). The 5-leg daily cascade then indexed past the style
array — `IndexError: index 1258 ... size 1258` — taking down every live
fund render on render-svc.

The guard truncates all daily series to the shortest common length
(left-aligned from day 0) and warns loudly. This test pins both the
completion and the warning.
"""

from __future__ import annotations

import logging

import numpy as np

from riskmodels.snapshots import _fund_data


class _FakeArr:
    def __init__(self, data, attrs=None):
        self._d = data
        self.attrs = attrs or {}

    def __getitem__(self, idx):
        return self._d[idx]


def _epoch_days(iso: str) -> int:
    return int(np.datetime64(iso).astype("datetime64[D]").astype(np.int64))


def _make_ragged_daily_zarr(n: int = 10, style_short_by: int = 2):
    """Daily zarr where style_return is `style_short_by` points short."""
    base = _epoch_days("2026-07-14")

    def _col(vals):
        return np.asarray(vals, dtype=float).reshape(-1, 1)

    gross = 0.001 * (1 + np.arange(n))
    style = 0.0005 * (1 + np.arange(n - style_short_by))
    return {
        "lag_basis": _FakeArr(np.array(["report_date"], dtype=object)),
        "teo": _FakeArr(
            base + np.arange(n, dtype=np.int64),
            attrs={"units": "days since 1970-01-01"},
        ),
        "gross_return": _FakeArr(_col(gross)),
        "l1_market": _FakeArr(_col(gross * 0.7)),
        "l2_sector": _FakeArr(_col(gross * 0.1)),
        "l3_subsector": _FakeArr(_col(gross * 0.05)),
        "l3_residual": _FakeArr(_col(gross * 0.15)),
        "style_return": _FakeArr(_col(style)),
    }


def test_ragged_daily_cube_truncates_and_warns(caplog, monkeypatch):
    def _fake_open(_bw_fund_id: str, store: str):
        if store == "ds_fund_returns_daily.zarr":
            data = _make_ragged_daily_zarr()
            return type("_Z", (), {"__getitem__": lambda self, k: data[k]})()
        raise FileNotFoundError(store)

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        fd = _fund_data.get_data_for_f1("BW-FUND-RAGGED", enrich=False)

    # Completes without IndexError; every daily series is truncated to the
    # common (shortest) length and ends at the shared coverage edge.
    n_points = len(fd.cum_nav_return)
    assert n_points > 0
    for series in (
        fd.cum_l1_market,
        fd.cum_l2_sector,
        fd.cum_l3_subsector,
        fd.cum_l3_residual,
    ):
        assert len(series) == n_points
    # 10 teo days from 2026-07-14, style 2 short → last date is day 7.
    assert fd.cum_nav_return[-1][0] == "2026-07-21"

    warnings = [r.message for r in caplog.records if "ragged" in r.message]
    assert warnings, "expected the ragged-cube warning to fire"
    assert "style" in warnings[0]
