"""Unit tests for the realized fund variance decomposition helper.

Mirrors RiskModels_API's TS `realizedVarianceShares` (canonical /api/snapshot):
shares from cov(strip_k, gross)/var(gross), summing to 1; None below the obs
floor or on degenerate variance; the residual share reflects realized
cross-holding correlation, not a count formula; negative (hedging) layers are
clamped to 0 and the positives renormalized.
"""

import random

import pytest

from riskmodels.snapshots._fund_data import (
    _MIN_REALIZED_FUND_OBS,
    _realized_variance_shares,
)


def _series(rows):
    """rows = list of (mkt, sec, sub, res); teo is just a label."""
    return [(f"2020-{i:02d}-01", m, s, u, r) for i, (m, s, u, r) in enumerate(rows, start=1)]


def test_returns_none_below_observation_floor():
    rows = [(0.01 * i, 0.0, 0.0, 0.0) for i in range(_MIN_REALIZED_FUND_OBS - 1)]
    assert _realized_variance_shares(_series(rows)) is None


def test_returns_none_for_degenerate_variance():
    # gross = mkt + ... = constant ⇒ var(gross) ≈ 0
    rows = [(0.01, 0.0, 0.0, 0.0) for _ in range(40)]
    assert _realized_variance_shares(_series(rows)) is None


def test_shares_sum_to_one_and_largest_amplitude_dominates():
    rng = random.Random(1)
    rows = []
    for _ in range(60):
        m = (rng.random() - 0.5) * 0.04          # widest
        s = (rng.random() - 0.5) * 0.02
        u = (rng.random() - 0.5) * 0.012
        r = (rng.random() - 0.5) * 0.016
        rows.append((m, s, u, r))
    out = _realized_variance_shares(_series(rows))
    assert out is not None
    assert sum(out.values()) == pytest.approx(1.0, abs=1e-9)
    for v in out.values():
        assert 0.0 <= v <= 1.0
    assert out["market"] > out["sector"]
    assert out["market"] > out["subsector"]
    assert out["market"] > out["residual"]


def test_residual_share_reflects_realized_cross_holding_correlation():
    # Two perfectly-correlated residual paths in the fund ⇒ residual variance
    # does NOT diversify away; a count formula (~1/N of single-name) would put
    # it far smaller. Here residual carries the bulk of the variance.
    rng = random.Random(7)
    rows = []
    for _ in range(80):
        m = (rng.random() - 0.5) * 0.01          # small market component
        r = (rng.random() - 0.5) * 0.05          # large common residual path
        rows.append((m, 0.0, 0.0, r))
    out = _realized_variance_shares(_series(rows))
    assert out is not None
    assert out["residual"] > 0.6
    assert out["sector"] == 0.0
    assert out["subsector"] == 0.0


def test_negative_hedging_layer_clamped_and_renormalized():
    rng = random.Random(11)
    rows = []
    for _ in range(50):
        m = (rng.random() - 0.5) * 0.03
        r = -0.6 * m                              # residual strip moves against the rest
        rows.append((m, 0.0, 0.0, r))
    out = _realized_variance_shares(_series(rows))
    assert out is not None
    assert out["residual"] == 0.0
    assert sum(out.values()) == pytest.approx(1.0, abs=1e-9)
