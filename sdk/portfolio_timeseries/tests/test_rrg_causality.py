"""Hermetic tests for the point-in-time (causal) property of the RRG classifier.

The regime split in DESHAW_REPORT_DATE §5 labels each holding by the quadrant its
sector occupied AS OF the report date. That is only legitimate if the labels use no
future information. ``rrg_classifier.verify_pit`` checks this against the live zarr
factor plane at 8 historical dates; these tests check the same property on synthetic
data, with no network, so the guarantee is protected in CI and cannot silently
regress when the plane is unreachable.

The property: RRG is built from cumprod and causal EWMs, so truncating the input
series at week T and recomputing must reproduce the full-history label at week T.
If anyone swaps an EWM for a centred/backward-looking window, these fail.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# rrg_classifier imports riskmodels at module load for its live-data helpers;
# the functions under test (compute_rrg, quad) are pure.
R = pytest.importorskip("rrg_classifier")


WEEKS = pd.date_range("2015-01-04", periods=200, freq="W")
FACTORS = ["FFX_XLK", "FFX_XLF", "FFX_XLE"]


def synthetic_series(seed=7):
    rng = np.random.default_rng(seed)
    fw = pd.DataFrame(rng.normal(0.001, 0.02, (len(WEEKS), len(FACTORS))),
                      index=WEEKS, columns=FACTORS)
    sw = pd.Series(rng.normal(0.001, 0.015, len(WEEKS)), index=WEEKS)
    return fw, sw


def test_truncating_the_history_reproduces_the_label_at_that_week():
    """The core point-in-time guarantee, at several cut points."""
    fw, sw = synthetic_series()
    rr_full, rm_full = R.compute_rrg(fw, sw)
    q_full = R.quad(rr_full, rm_full)

    for cut in (60, 100, 150, 199):
        as_of = WEEKS[cut]
        rr_t, rm_t = R.compute_rrg(fw[fw.index <= as_of], sw[sw.index <= as_of])
        q_t = R.quad(rr_t, rm_t)
        assert q_t.index[-1] == as_of
        for f in FACTORS:
            assert q_t.loc[as_of, f] == q_full.loc[as_of, f], (
                f"label at {as_of.date()} for {f} changed when future weeks were "
                "removed -- the classifier is not causal")


def test_future_data_cannot_change_a_past_label():
    """Appending wildly different future weeks must leave every earlier label intact."""
    fw, sw = synthetic_series()
    cut = 120
    as_of = WEEKS[cut]

    rr_a, rm_a = R.compute_rrg(fw[fw.index <= as_of], sw[sw.index <= as_of])
    q_a = R.quad(rr_a, rm_a)

    shocked = fw.copy()
    shocked.iloc[cut + 1:] += 0.25          # a violent future regime change
    rr_b, rm_b = R.compute_rrg(shocked, sw)
    q_b = R.quad(rr_b, rm_b)

    for f in FACTORS:
        assert q_a.loc[as_of, f] == q_b.loc[as_of, f], (
            "a future shock rewrote a past label -- leakage")


def test_quadrant_rules_match_amans_definitions():
    """The four quadrants are defined off the 100 centre line. Pinned so a refactor
    cannot quietly relabel (which would invert the momentum/reversion reading)."""
    rr = pd.DataFrame({"a": [101.0, 101.0, 99.0, 99.0]})
    rm = pd.DataFrame({"a": [101.0, 99.0, 99.0, 101.0]})
    got = list(R.quad(rr, rm)["a"])
    assert got == ["Leading", "Weakening", "Lagging", "Improving"]


def test_span_is_amans_and_unchanged():
    """Aman's EWM span is 10 and the thresholds are 100. A different span is a
    different classifier and would not reproduce his published signal counts."""
    assert R.SPAN == 10
    assert R.QUADRANTS == ("Leading", "Improving", "Weakening", "Lagging")
