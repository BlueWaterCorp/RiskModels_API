"""Hermetic tests for the window primitives in ``build_lagged``.

These protect the core measurement path that every published number in this project
runs through. No network, no cache: the module-level return and decomposition caches
are populated directly with synthetic series.

The NaN tests are the important ones. A NaN-poisoning bug in ``window_return``
silently nulled whole quarters for months and moved published results materially
(D. E. Shaw n 36->49 and the headline flipped; Berkshire n 35->42 and the lagged
Sharpe went 0.85->0.99). ``test_nan_day_does_not_poison_*`` exists so that class of
bug cannot come back unnoticed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_lagged as B  # noqa: E402


# --------------------------------------------------------------------------
# fixtures: synthetic series injected straight into the module caches
# --------------------------------------------------------------------------
DAYS = pd.date_range("2020-01-01", periods=20, freq="D")


@pytest.fixture(autouse=True)
def clean_caches():
    """Isolate every test from the real cache and from each other."""
    saved_r, saved_d = dict(B._ret_cache), dict(B._decomp_cache)
    saved_td = B._tdays
    B._ret_cache.clear()
    B._decomp_cache.clear()
    B._tdays = None
    yield
    B._ret_cache.clear()
    B._ret_cache.update(saved_r)
    B._decomp_cache.clear()
    B._decomp_cache.update(saved_d)
    B._tdays = saved_td


def put_returns(ticker, values, index=DAYS):
    B._ret_cache[ticker] = pd.Series(np.asarray(values, dtype=float), index=index)


def put_decomp(ticker, layers, index=DAYS):
    B._decomp_cache[ticker] = {
        k: pd.Series(np.asarray(v, dtype=float), index=index) for k, v in layers.items()
    }


# --------------------------------------------------------------------------
# window_return: compounding and window bounds
# --------------------------------------------------------------------------
def test_window_return_compounds_buy_and_hold():
    put_returns("AAA", [0.10] + [0.0] * 19)
    # (start, end] excludes day 0, so a 10% move ON day 0 is outside the window
    assert B.window_return("AAA", DAYS[0], DAYS[5]) == pytest.approx(0.0)
    # ... and inside it when the window opens before that day
    r = B.window_return("AAA", DAYS[0] - pd.Timedelta(days=1), DAYS[5])
    assert r == pytest.approx(0.10)


def test_window_return_is_half_open_start_exclusive_end_inclusive():
    """(start, end] -- the convention that makes chained windows non-overlapping."""
    put_returns("AAA", [0.01] * 20)
    full = B.window_return("AAA", DAYS[0], DAYS[10])      # days 1..10 -> 10 days
    assert full == pytest.approx(1.01 ** 10 - 1)
    # chaining two adjacent windows must equal the single wide window, exactly
    a = B.window_return("AAA", DAYS[0], DAYS[5])
    b = B.window_return("AAA", DAYS[5], DAYS[10])
    assert (1 + a) * (1 + b) - 1 == pytest.approx(full)


def test_window_return_unknown_ticker_is_none_not_zero():
    """A name with no data must be skipped, never silently treated as a 0% return."""
    B._ret_cache["MISSING"] = None
    assert B.window_return("MISSING", DAYS[0], DAYS[5]) is None


# --------------------------------------------------------------------------
# NaN handling -- regression tests for the bug that moved published results
# --------------------------------------------------------------------------
def test_nan_day_does_not_poison_a_names_window_return():
    """REGRESSION. One NaN day inside the window must be dropped, not propagated.

    The original bug compounded prod(1+r) over the raw slice, so a single NaN day
    returned NaN for the whole name.
    """
    vals = [0.01] * 20
    vals[3] = np.nan
    put_returns("AAA", vals)
    r = B.window_return("AAA", DAYS[0], DAYS[10])
    assert r is not None
    assert not np.isnan(r), "a single NaN day nulled the whole window -- the bug is back"
    assert r == pytest.approx(1.01 ** 9 - 1)   # 10 days in window, 1 dropped


def test_all_nan_name_returns_none_so_it_is_skipped_not_counted():
    """A name with no usable day is None (skipped), NOT 0.0 (counted as flat)."""
    put_returns("AAA", [np.nan] * 20)
    assert B.window_return("AAA", DAYS[0], DAYS[10]) is None


def test_nan_name_does_not_poison_the_portfolio_and_is_not_counted_as_covered():
    """REGRESSION -- the exact failure mode that nulled entire quarters.

    A freshly-IPO'd 3 bps name (Zillow in D. E. Shaw's 2013-Q4 book) had NaN for
    every day in the window. It still counted toward ``covered`` while poisoning the
    weighted sum, so the whole quarter went NaN -- silently, with healthy-looking
    coverage. Both halves are asserted here: the portfolio return survives, and the
    dead name is excluded from the coverage denominator.
    """
    put_returns("BIG", [0.01] * 20)
    put_returns("ZILLOW", [np.nan] * 20)          # 0.03% of book, all-NaN
    holdings = [{"ticker": "BIG", "weight": 0.9997},
                {"ticker": "ZILLOW", "weight": 0.0003}]

    renorm, asis, covered, n, missing = B.portfolio_window_return(holdings, DAYS[0], DAYS[10])

    assert not np.isnan(renorm), "one all-NaN name nulled the portfolio -- the bug is back"
    assert renorm == pytest.approx(1.01 ** 10 - 1)
    assert covered == pytest.approx(0.9997), "the dead name must not inflate covered weight"
    assert n == 1
    assert [m[0] for m in missing] == ["ZILLOW"]


def test_restricted_row_with_no_ticker_is_reported_missing():
    """Confidential-treatment rows (ticker=None, security_id BW-RESTRICTED) are
    excluded from coverage and named in `missing`, not dropped without trace."""
    put_returns("BIG", [0.01] * 20)
    holdings = [{"ticker": "BIG", "weight": 0.97}, {"ticker": None, "weight": 0.03}]
    renorm, _, covered, n, missing = B.portfolio_window_return(holdings, DAYS[0], DAYS[10])
    assert covered == pytest.approx(0.97)
    assert n == 1
    assert missing == [("<restricted>", 0.03)]
    assert renorm == pytest.approx(1.01 ** 10 - 1)


# --------------------------------------------------------------------------
# portfolio aggregation
# --------------------------------------------------------------------------
def test_portfolio_window_return_renormalises_to_covered_weight():
    """With half the book uncovered, the renormalised return is the covered book's
    return -- not a number diluted by the missing half."""
    put_returns("AAA", [0.02] * 20)
    B._ret_cache["GONE"] = None
    holdings = [{"ticker": "AAA", "weight": 0.5}, {"ticker": "GONE", "weight": 0.5}]
    renorm, asis, covered, n, _ = B.portfolio_window_return(holdings, DAYS[0], DAYS[5])
    expected = 1.02 ** 5 - 1
    assert renorm == pytest.approx(expected)
    assert asis == pytest.approx(0.5 * expected)     # un-renormalised is half
    assert covered == pytest.approx(0.5)


def test_portfolio_window_return_is_nan_when_nothing_is_covered():
    B._ret_cache["GONE"] = None
    renorm, _, covered, n, _ = B.portfolio_window_return(
        [{"ticker": "GONE", "weight": 1.0}], DAYS[0], DAYS[5])
    assert np.isnan(renorm)
    assert covered == 0.0 and n == 0


# --------------------------------------------------------------------------
# layer decomposition: the ERM3 additivity identity
# --------------------------------------------------------------------------
def test_layers_sum_to_gross_the_erm3_additivity_identity():
    """market + sector + subsector + idio == gross, per name, per day.

    This is the property the whole layer attribution rests on. Each layer is
    compounded as its own stream, so the sum carries a small geometric linking
    residual against the compounded gross -- second order in the daily returns,
    and asserted loosely here for that reason.
    """
    n = 20
    rng = np.random.default_rng(0)
    mkt = rng.normal(0, 0.004, n)
    sec = rng.normal(0, 0.002, n)
    sub = rng.normal(0, 0.001, n)
    idio = rng.normal(0, 0.003, n)
    put_decomp("AAA", {"market": mkt, "sector": sec, "subsector": sub, "idiosyncratic": idio})
    put_returns("AAA", mkt + sec + sub + idio)       # daily additivity by construction

    lay = B.name_layer_windows("AAA", DAYS[0], DAYS[10])
    gross = B.window_return("AAA", DAYS[0], DAYS[10])
    assert abs(sum(lay.values()) - gross) < 5e-4     # linking residual only


def test_layer_windows_drop_nan_days_like_the_gross_path():
    """The decomposition path always dropped NaN; assert it still does, so the two
    paths cannot drift apart again (that inconsistency is what hid the gross bug)."""
    vals = [0.001] * 20
    nan_vals = list(vals)
    nan_vals[4] = np.nan
    put_decomp("AAA", {"market": nan_vals, "sector": vals,
                       "subsector": vals, "idiosyncratic": vals})
    lay = B.name_layer_windows("AAA", DAYS[0], DAYS[10])
    assert lay is not None
    assert not np.isnan(lay["market"])
    assert lay["market"] == pytest.approx(1.001 ** 9 - 1)
    assert lay["sector"] == pytest.approx(1.001 ** 10 - 1)


def test_portfolio_window_layers_renormalises_to_covered_names():
    put_decomp("AAA", {"market": [0.001] * 20, "sector": [0.0] * 20,
                       "subsector": [0.0] * 20, "idiosyncratic": [0.0] * 20})
    B._decomp_cache["GONE"] = None
    holdings = [{"ticker": "AAA", "weight": 0.4}, {"ticker": "GONE", "weight": 0.6}]
    lay = B.portfolio_window_layers(holdings, DAYS[0], DAYS[10])
    assert lay["market"] == pytest.approx(1.001 ** 10 - 1)


# --------------------------------------------------------------------------
# entry-date convention -- 45 CALENDAR days, rolled to the next trading day
# --------------------------------------------------------------------------
def test_entry_date_is_45_calendar_days_rolled_to_next_trading_day():
    """The documented convention, pinned against the two verified real cases.

    Section 13(f) is 45 CALENDAR days, not 45 trading days. 2025-12-31 + 45d is
    Saturday 2026-02-14; the Monday is Presidents' Day, so entry is Tuesday
    2026-02-17. Anyone 'fixing' this to trading days breaks every lagged number.
    """
    cal = pd.bdate_range("2013-01-01", "2027-01-01")
    holidays = {pd.Timestamp("2026-02-16")}                    # Presidents' Day
    B._tdays = pd.DatetimeIndex([d for d in cal if d not in holidays])

    assert B.entry_date("2025-12-31") == pd.Timestamp("2026-02-17")
    assert B.entry_date("2026-03-31") == pd.Timestamp("2026-05-15")
    # 45 calendar days, never 45 trading days (which would land ~2 weeks later)
    assert (B.entry_date("2026-03-31") - pd.Timestamp("2026-03-31")).days == 45


def test_fwd_quarter_end_is_a_calendar_quarter_not_the_next_teo():
    """Window ends at teo + 3 calendar months. Using 'the next teo in the series'
    silently doubled windows across the gaps in that series (a -600 bps artifact)."""
    assert B.fwd_quarter_end("2023-06-30") == pd.Timestamp("2023-09-30")
    assert B.fwd_quarter_end("2021-03-31") == pd.Timestamp("2021-06-30")


# --------------------------------------------------------------------------
# the validation gate
# --------------------------------------------------------------------------
@pytest.mark.parametrize("bps,expected", [
    (0.0, "CLEAN"), (24.9, "CLEAN"),
    (25.0, "PROCEED_WITH_FLAG"), (65.0, "PROCEED_WITH_FLAG"), (75.0, "PROCEED_WITH_FLAG"),
    (75.1, "STOP"), (78.0, "STOP"), (1020.0, "STOP"),
])
def test_gate_verdict_thresholds(bps, expected):
    assert B.gate_verdict(bps) == expected


def test_gate_verdict_pins_the_two_real_decisions():
    """The gate is only worth having if it actually decided something.

    Berkshire's rebuild passed at 61 bps and its results were published with a flag.
    D. E. Shaw's failed at 78 bps and its lagged results were withheld entirely.
    """
    assert B.gate_verdict(61.2) == "PROCEED_WITH_FLAG"    # Berkshire, published
    assert B.gate_verdict(78.0) == "STOP"                 # D. E. Shaw, withheld


# --------------------------------------------------------------------------
# stats helper
# --------------------------------------------------------------------------
def test_stats_skips_none_and_nan_without_biasing_the_mean():
    clean = B.stats([0.01, 0.02, 0.03])
    dirty = B.stats([0.01, None, 0.02, float("nan"), 0.03])
    assert dirty["n"] == clean["n"] == 3
    assert dirty["mean_bps"] == pytest.approx(clean["mean_bps"])


def test_stats_sharpe_is_quarterly_annualised_gross():
    """Sharpe = mean/sd * sqrt(4) on quarterly data, with NO risk-free deduction.
    Every Sharpe in this project is gross; that has to stay true."""
    vals = [0.05, 0.05, 0.05, 0.05]
    s = B.stats(vals)
    assert np.isnan(s["sharpe"])          # zero variance -> undefined, not infinite
    s2 = B.stats([0.10, 0.00, 0.10, 0.00])
    expected = (np.mean([0.1, 0, 0.1, 0]) / np.std([0.1, 0, 0.1, 0], ddof=1)) * 2.0
    assert s2["sharpe"] == pytest.approx(expected)
