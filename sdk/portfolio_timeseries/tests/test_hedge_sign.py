"""Pins the hedge SIGN convention of the market-neutral overlay (PR #373 review, finding 9;
BWMACRO D.8.57).

The SDK docstring and fixture say ``decompose()["hedge"][etf] == -hr`` (a signed position,
negative = short). The overlay was built and empirically validated on the opposite reading
(a positive per-dollar short ratio). Nothing used to test which one the code assumed, so a
vendor-side sign change would silently invert every overlay. These tests make the convention
explicit, single-sourced and loud:

  * the convention lives in exactly one flag, ``HEDGE_IS_SHORT_RATIO``;
  * ``construct()`` produces a POSITIVE short notional for a long-beta book under that flag;
  * flipping the flag flips the overlay, and nothing else changes;
  * a name whose ``decompose()`` carries no hedge block is REPORTED, not silently dropped.

Hermetic: a fake client, no network, no cache.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
xr = pytest.importorskip("xarray")

import market_neutral_overlay as mno  # noqa: E402
from market_neutral_overlay import MarketNeutralOverlay, hedge_short_ratio  # noqa: E402


class _FakeClient:
    """decompose() returns a per-ticker hedge dict; empty dict simulates the AAPL gap."""

    def __init__(self, hedges):
        self.hedges = hedges
        self.calls = []

    def decompose(self, ticker):
        self.calls.append(ticker)
        return {"hedge": dict(self.hedges.get(ticker, {})), "exposure": {}}


def _snapshot(positions):
    tickers = list(positions)
    dollars = np.array([positions[t] for t in tickers], dtype=float)
    return xr.Dataset({"dollars": ("ticker", dollars)}, coords={"ticker": tickers})


@pytest.fixture(autouse=True)
def _restore_flag():
    saved = mno.HEDGE_IS_SHORT_RATIO
    yield
    mno.HEDGE_IS_SHORT_RATIO = saved


def test_convention_is_single_sourced_in_one_flag():
    mno.HEDGE_IS_SHORT_RATIO = True
    assert hedge_short_ratio(0.5) == 0.5
    mno.HEDGE_IS_SHORT_RATIO = False
    assert hedge_short_ratio(0.5) == -0.5
    assert hedge_short_ratio(-0.5) == 0.5


def test_long_book_shorts_the_market_under_the_validated_convention():
    """What the July 2026 realized-beta charts were built on: hedge = +short ratio."""
    mno.HEDGE_IS_SHORT_RATIO = True
    client = _FakeClient({"AAA": {"SPY": 1.2, "XLK": 0.3}, "BBB": {"SPY": 0.8, "XLF": 0.5}})
    ov = MarketNeutralOverlay(_snapshot({"AAA": 100.0, "BBB": 50.0})).construct(client)
    assert ov.etf_shorts["SPY"] == pytest.approx(100 * 1.2 + 50 * 0.8)
    assert ov.etf_shorts["XLK"] == pytest.approx(30.0)
    assert ov.etf_shorts["XLF"] == pytest.approx(25.0)
    assert ov.etf_shorts["SPY"] > 0, "a long-only book must SHORT the market ETF"
    assert all(abs(v) < 1e-9 for v in ov.residual_exposure.values())


def test_flipping_the_flag_inverts_the_overlay_and_nothing_else():
    """If the vendor settles on the SDK-documented sign (hedge == -hr), the fix is the flag."""
    client = _FakeClient({"AAA": {"SPY": -1.2}})          # documented form: negative = short
    mno.HEDGE_IS_SHORT_RATIO = True
    wrong = MarketNeutralOverlay(_snapshot({"AAA": 100.0})).construct(client)
    mno.HEDGE_IS_SHORT_RATIO = False
    right = MarketNeutralOverlay(_snapshot({"AAA": 100.0})).construct(client)
    assert wrong.etf_shorts["SPY"] == pytest.approx(-120.0)
    assert right.etf_shorts["SPY"] == pytest.approx(+120.0)
    assert set(wrong.etf_shorts) == set(right.etf_shorts) == {"SPY"}


def test_name_with_no_hedge_block_is_reported_not_silently_dropped():
    """The 2026-09-22 AAPL case: hedge={} on the largest position. The overlay must say so."""
    mno.HEDGE_IS_SHORT_RATIO = True
    client = _FakeClient({"BIG": {}, "SMALL": {"SPY": 1.0}})
    mo = MarketNeutralOverlay(_snapshot({"BIG": 900.0, "SMALL": 100.0}))
    ov = mo.construct(client)
    assert mo.unhedged_tickers == ["BIG"]
    # the overlay covers only what it could hedge — and that is visible, not hidden
    assert ov.etf_shorts["SPY"] == pytest.approx(100.0)


def test_short_leg_passes_signed_dollars_through():
    """Signed-dollar convention from pair_trade: a short position flips the hedge."""
    mno.HEDGE_IS_SHORT_RATIO = True
    client = _FakeClient({"AAA": {"SPY": 1.0}})
    ov = MarketNeutralOverlay(_snapshot({"AAA": -100.0})).construct(client)
    assert ov.etf_shorts["SPY"] == pytest.approx(-100.0)   # i.e. a LONG SPY leg
