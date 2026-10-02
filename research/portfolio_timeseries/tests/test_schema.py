"""Unit tests for portfolio_timeseries.schema (mock holdings + as_of_snapshot).

Covers: mock-builder round-trip, ``as_of`` using ``available_date`` not
``report_date``, the 45-day lag, gap forward-fill, and the empty-Dataset-before-
any-snapshot case.
"""

from __future__ import annotations

from datetime import date

import pytest

pytest.importorskip("xarray")

import pandas as pd

from portfolio_timeseries import as_of_snapshot


def _is_empty(snap) -> bool:
    """A snapshot with no data points (before any filing is actionable)."""
    return snap["dollars"].size == 0


def _report_date(snap) -> pd.Timestamp:
    return pd.Timestamp(snap["report_date"].values)


# --------------------------------------------------------------------------
# 1. Mock builder round-trip
# --------------------------------------------------------------------------

def test_mock_builder_dims_coords_and_vars(mock_holdings):
    ds = mock_holdings
    assert ds.sizes == {"report_date": 3, "available_date": 3, "ticker": 2}
    assert set(ds.data_vars) == {"shares", "dollars", "weight"}
    # Bi-temporal date coords are real datetimes; ticker + scalar cik present.
    assert ds["report_date"].dtype == "datetime64[ns]"
    assert ds["available_date"].dtype == "datetime64[ns]"
    assert list(ds["ticker"].values) == ["AAA", "BBB"]
    assert ds["cik"].item() == "0001067983"
    # Each filing's weights sum to 1 across tickers (on its populated diagonal).
    for i in range(3):
        w = ds["weight"].isel(report_date=i, available_date=i)
        assert float(w.sum()) == pytest.approx(1.0)


# --------------------------------------------------------------------------
# 2. as_of uses available_date, NOT report_date (anti-look-ahead)
# --------------------------------------------------------------------------

def test_as_of_filters_on_available_date_not_report_date(mock_holdings):
    # 2024-07-15: Q2's report_date (2024-06-30) has passed, so a naive
    # report_date filter would (wrongly) surface Q2 — but Q2 is not public until
    # 2024-08-14. Correct behaviour returns Q1 (public since 2024-05-15).
    snap = as_of_snapshot(mock_holdings, date(2024, 7, 15))
    assert _report_date(snap) == pd.Timestamp("2024-03-31")  # Q1, not Q2
    assert not _is_empty(snap)


# --------------------------------------------------------------------------
# 3. as_of respects the 45-day lag
# --------------------------------------------------------------------------

def test_as_of_respects_45_day_lag(mock_holdings):
    # The live default is now lag_days=0 (real filing dates), so we pass
    # lag_days=45 explicitly here to exercise the Sammon-proxy gate itself.
    # Q1 available_date = 2024-05-15.
    # 2024-06-01 is only 17 days later -> not yet actionable -> empty.
    assert _is_empty(as_of_snapshot(mock_holdings, date(2024, 6, 1), lag_days=45))
    # 2024-07-01 is 47 days later -> actionable -> returns Q1.
    snap = as_of_snapshot(mock_holdings, date(2024, 7, 1), lag_days=45)
    assert not _is_empty(snap)
    assert _report_date(snap) == pd.Timestamp("2024-03-31")


# --------------------------------------------------------------------------
# 4. as_of in a gap -> most recent visible (forward-fill)
# --------------------------------------------------------------------------

def test_as_of_in_gap_forward_fills_most_recent_visible(mock_holdings):
    # 2024-10-01: Q2 (available 2024-08-14, +45 = 2024-09-28) IS visible; Q3
    # (available 2024-11-14) is not. Between Q2's and Q3's visibility dates the
    # most recent visible snapshot — Q2 — is carried forward.
    snap = as_of_snapshot(mock_holdings, date(2024, 10, 1))
    assert _report_date(snap) == pd.Timestamp("2024-06-30")  # Q2


# --------------------------------------------------------------------------
# 5. as_of before any snapshot is visible -> empty Dataset (not an error)
# --------------------------------------------------------------------------

def test_as_of_before_any_snapshot_returns_empty(mock_holdings):
    snap = as_of_snapshot(mock_holdings, date(2024, 1, 1))
    assert _is_empty(snap)
    # Structure is preserved (still a Dataset with the same data vars).
    assert set(snap.data_vars) == {"shares", "dollars", "weight"}


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
