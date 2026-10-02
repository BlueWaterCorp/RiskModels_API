"""Regression tests for the three defects found in PR review (2026-09-22).

Each of these was a silent error that changed a published number. They are pinned here so
the same mistake cannot be reintroduced without a test failing.

  1. Window anchoring — trading-day offsets from quarter end are NOT calendar days, so a
     "+45" report-anchored window is nowhere near the +45-CALENDAR-day disclosure date.
  2. Look-ahead — a book whose fetch had to escalate past the tight teo+55 buffer was not
     public at teo+45, so entering it there is look-ahead.
  3. Window-length basis — a multi-quarter window counted as one quarterly draw inflates
     the mean, t, Sharpe and the annualised figure.

All hermetic: no network, no credentials, no cache dependency.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_lagged as bl  # noqa: E402


# ----------------------------------------------------------------- 1. window anchoring
def test_calendar_45d_is_about_32_trading_days_not_45():
    """The defect: report-anchored trading-day offsets were labelled as if they were the
    calendar +45d disclosure date. A +45..+55 trading-day window actually sits ~13-23
    trading days AFTER disclosure, so the 'commercial window' was never measured."""
    td = bl.trading_days()
    if len(td) < 300:
        pytest.skip("trading calendar unavailable")
    offsets = []
    for teo in ("2015-03-31", "2018-06-30", "2021-09-30", "2024-12-31"):
        e = bl.entry_date(teo)
        if pd.isna(e):
            continue
        anchor = int(td.searchsorted(pd.Timestamp(teo), side="right")) - 1
        entry = int(td.searchsorted(e, side="left"))
        offsets.append(entry - anchor)
    assert offsets, "no usable teos in the calendar"
    # ~45 calendar days is ~31-33 trading days, and decisively NOT 45.
    assert all(28 <= o <= 36 for o in offsets), offsets
    assert all(o < 40 for o in offsets), (
        "a calendar-45d entry must never be as late as trading day +45; if this fires, "
        "report-anchored and entry-anchored windows have been conflated again"
    )


def test_entry_anchored_window_starts_at_disclosure():
    """E must begin the trading day AFTER the book is public, not before it."""
    drd = pytest.importorskip("deshaw_report_date")
    ds, de, basis = drd.WINDOWS["E_post10"]
    assert basis == "entry", "E must be anchored at disclosure, not at quarter end"
    teo = "2021-09-30"
    b = drd.win_bounds(teo, ds, de, basis)
    if b is None:
        pytest.skip("window outside the available calendar")
    start, end = b
    entry = bl.entry_date(teo)
    assert start >= entry, "E starts before the book is public — look-ahead"
    assert (end - start).days <= 20, "E should span ~10 trading days"


# ----------------------------------------------------------------- 2. look-ahead guard
def test_escalated_book_is_not_entered_before_it_was_public():
    """A book retrievable only at teo+90 was not public at teo+45; entry must be floored."""
    teo = "2020-06-30"
    rec = {"filing_date": None, "as_of_requested": "2020-09-28"}  # teo + 90d
    entry, floored = bl.lagged_entry(teo, rec)
    assert floored is True
    assert entry >= pd.Timestamp("2020-09-28"), entry
    assert entry > bl.entry_date(teo), "floor did not move the entry forward"


def test_unescalated_book_keeps_the_plain_45_day_entry():
    """The common case (book returned at the tight teo+55 buffer, filed on the deadline)
    must be untouched — the guard is a floor, not a blanket delay."""
    teo = "2021-03-31"
    rec = {"filing_date": str(bl.entry_date(teo).date()), "as_of_requested": "2021-05-25"}
    entry, floored = bl.lagged_entry(teo, rec)
    assert floored is False
    assert entry == bl.entry_date(teo)


def test_late_filing_date_floors_entry_even_without_escalation():
    teo = "2021-03-31"
    rec = {"filing_date": "2021-06-30", "as_of_requested": "2021-05-25"}
    entry, floored = bl.lagged_entry(teo, rec)
    assert floored is True
    assert entry >= pd.Timestamp("2021-06-30")


# ----------------------------------------------------------------- 3. window-length basis
def _recs(pairs):
    return [{"v": v, "q_len": q} for v, q in pairs]


def test_multi_quarter_window_is_not_counted_as_one_quarterly_draw():
    """Two windows with identical per-quarter performance, one held twice as long. The
    per-quarter mean must be identical; the naive version would double the long one."""
    recs = _recs([(0.02, 1.0)] * 6 + [(0.04, 2.0)] * 2)   # 4% over 2 quarters == 2%/q
    st = bl.stats_qnorm(recs, lambda r: r["v"])
    assert st["mean_bps"] == pytest.approx(200.0, abs=1e-6)
    assert st["std_bps"] == pytest.approx(0.0, abs=1e-6)
    assert st["n_multi_quarter"] == 2


def test_annualisation_uses_summed_window_length_not_n_over_4():
    recs = _recs([(0.02, 1.0)] * 4 + [(0.04, 2.0)] * 2)
    st = bl.stats_qnorm(recs, lambda r: r["v"])
    assert st["years"] == pytest.approx((4 * 1.0 + 2 * 2.0) / 4.0)
    assert st["q_len_sum"] == pytest.approx(8.0)
    # n/4 would have been 6/4 = 1.5 years; the true span is 2.0
    assert st["years"] > 6 / 4.0


def test_qnorm_matches_plain_stats_when_every_window_is_one_quarter():
    """No multi-quarter windows => the two bases must agree exactly. This is what makes it
    safe to quote a single figure."""
    vals = [0.03, -0.01, 0.05, 0.02, -0.02, 0.04]
    a = bl.stats_qnorm(_recs([(v, 1.0) for v in vals]), lambda r: r["v"])
    b = bl.stats(vals)
    for k in ("n", "mean_bps", "t", "sharpe", "hit", "cum_pct"):
        assert a[k] == pytest.approx(b[k], rel=1e-9), k


def test_qnorm_skips_none_and_nan():
    recs = _recs([(0.02, 1.0), (None, 1.0), (float("nan"), 1.0), (0.04, 2.0)])
    st = bl.stats_qnorm(recs, lambda r: r["v"])
    assert st["n"] == 2
