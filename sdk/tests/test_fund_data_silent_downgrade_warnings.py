"""``get_data_for_f1`` — silent-downgrade visibility tests (MASTER_BACKLOG P.4).

When ``ds_fund_returns_daily.zarr`` is missing for a fund, the loader used
to silently fall back to monthly NAV granularity. The fix logs a WARNING
so operators can see in render-svc logs which funds are rendering coarse
charts (12 monthly points instead of ~252 daily) without having to spot
the difference visually.
"""

from __future__ import annotations

import logging

import pytest

from riskmodels.snapshots import _fund_data


def _make_open_zarr_that_only_misses_daily(monkeypatch):
    """Patch _open_fund_zarr to raise FileNotFoundError only for the
    daily-returns store. Other stores still soft-fail (no real data path
    needed for these tests — we just care about the warning emission)."""
    def _fake_open(_bw_fund_id: str, store: str):
        if store == "ds_fund_returns_daily.zarr":
            raise FileNotFoundError("test: daily store intentionally missing")
        raise FileNotFoundError(store)  # other stores also missing; OK

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})


def test_warns_when_daily_returns_zarr_missing(caplog, monkeypatch):
    """The headline P.4 fix: a missing daily store emits a WARN that
    names the fund + the missing-file class so operators can grep logs."""
    _make_open_zarr_that_only_misses_daily(monkeypatch)
    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-DAILY-MISSING", enrich=False)
    daily_warnings = [
        r for r in caplog.records
        if "ds_fund_returns_daily.zarr unavailable" in r.message
    ]
    assert len(daily_warnings) == 1
    assert "BW-FUND-DAILY-MISSING" in daily_warnings[0].message
    assert "FileNotFoundError" in daily_warnings[0].message
    assert "monthly NAV granularity" in daily_warnings[0].message
    assert daily_warnings[0].levelno == logging.WARNING


def test_warning_message_mentions_fallback_path(caplog, monkeypatch):
    """Operators need to know WHAT the fallback is — the message must
    name 'monthly NAV' so they understand the chart still draws (just
    coarser) rather than thinking it's a full data outage."""
    _make_open_zarr_that_only_misses_daily(monkeypatch)
    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-X", enrich=False)
    msg = next(
        r.message for r in caplog.records
        if "ds_fund_returns_daily" in r.message
    )
    # Tells operator: chart still draws (just coarser), not "F1 is broken".
    assert "monthly" in msg.lower()
    assert "preferred" in msg.lower()  # signals "this isn't normal"


def test_no_warning_when_daily_zarr_open_succeeds(caplog, monkeypatch):
    """When the daily store opens cleanly the warning must NOT fire —
    avoids producing noise on the happy path."""
    # Build a minimal fake daily zarr that opens OK and provides the
    # required keys with empty arrays — the loader will window+drop them
    # and not change cum_nav, but the try block won't raise.
    import numpy as np

    class _FakeArr:
        def __init__(self, data, attrs=None):
            self._d = data
            self.attrs = attrs or {}

        def __getitem__(self, idx):
            return self._d[idx]

    class _FakeDailyZarr:
        def __init__(self):
            # Provide a minimal valid lag_basis with "report_date".
            self._data = {
                "lag_basis": _FakeArr(np.array(["report_date"], dtype=object)),
                "teo": _FakeArr(
                    np.array([], dtype=np.int64),
                    attrs={"units": "days since 1970-01-01"},
                ),
                "gross_return": _FakeArr(np.zeros((0, 1), dtype=float)),
                "l1_market": _FakeArr(np.zeros((0, 1), dtype=float)),
                "l2_sector": _FakeArr(np.zeros((0, 1), dtype=float)),
                "l3_subsector": _FakeArr(np.zeros((0, 1), dtype=float)),
                "l3_residual": _FakeArr(np.zeros((0, 1), dtype=float)),
            }

        def __getitem__(self, k):
            return self._data[k]

    def _fake_open(_bw_fund_id: str, store: str):
        if store == "ds_fund_returns_daily.zarr":
            return _FakeDailyZarr()
        raise FileNotFoundError(store)

    monkeypatch.setattr(_fund_data, "_open_fund_zarr", _fake_open)
    monkeypatch.setattr(_fund_data, "_fund_identity", lambda _id: {})

    with caplog.at_level(logging.WARNING, logger="riskmodels.snapshots._fund_data"):
        _fund_data.get_data_for_f1("BW-FUND-DAILY-PRESENT", enrich=False)
    daily_warnings = [
        r for r in caplog.records
        if "ds_fund_returns_daily.zarr unavailable" in r.message
    ]
    assert daily_warnings == []
