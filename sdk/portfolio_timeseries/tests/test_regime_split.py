"""End-to-end test for the regime-split integration point (wired to Aman's RRG classifier).

Hermetic (synthetic per-name labels + synthetic returns, no cache/network): the report-date
window return splits cleanly into the four regime buckets, weights partition to 1.0, and bucket
contributions sum exactly to the covered-book return. Also tests the factor->name bridge
(name_labels) that maps Aman's per-factor labels onto held names.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("pandas")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_lagged  # noqa: E402
import regime_split  # noqa: E402
from regime_split import QUADRANTS, window_return_by_regime, name_labels  # noqa: E402


# 5-name synthetic book; weights sum to 1.0. Synthetic 10-day window returns per name.
_BOOK = [
    {"ticker": "LEAD1", "weight": 0.30},
    {"ticker": "LEAD2", "weight": 0.20},
    {"ticker": "LAG1", "weight": 0.25},
    {"ticker": "IMPR1", "weight": 0.15},
    {"ticker": "NOLBL", "weight": 0.10},  # deliberately unlabeled
]
_RET = {"LEAD1": 0.05, "LEAD2": 0.03, "LAG1": -0.02, "IMPR1": 0.01, "NOLBL": 0.04}
_LABELS = {"LEAD1": "Leading", "LEAD2": "Leading", "LAG1": "Lagging", "IMPR1": "Improving"}


def test_name_labels_bridge():
    # factor labels + ticker->factor map -> per-name labels; unmapped/unlabeled names excluded
    factor_labels = {"FFX_XLK": "Leading", "FFX_XLF": "Lagging"}
    tmap = {"LEAD1": "FFX_XLK", "LEAD2": "FFX_XLK", "LAG1": "FFX_XLF", "NOLBL": "FFX_XLE"}  # XLE unlabeled
    got = name_labels(_BOOK, factor_labels, tmap)
    assert got == {"LEAD1": "Leading", "LEAD2": "Leading", "LAG1": "Lagging"}
    assert "NOLBL" not in got  # factor XLE has no label
    assert "IMPR1" not in got  # ticker not in the map


@pytest.fixture
def patched(monkeypatch):
    # hermetic: fixed window bounds, dict-lookup returns — no cache, no API
    monkeypatch.setattr(regime_split, "win_bounds", lambda teo, ds, de: ("2020-01-01", "2020-01-15"))
    monkeypatch.setattr(build_lagged, "window_return", lambda tk, s, e: _RET.get(tk))


def test_weights_partition_to_one(patched):
    res = window_return_by_regime(_BOOK, "2020-01-01", "A_1_10", _LABELS)
    total_w = sum(res[q]["weight"] for q in (*QUADRANTS, "unlabeled"))
    assert total_w == pytest.approx(1.0)


def test_contribs_sum_to_covered_return(patched):
    res = window_return_by_regime(_BOOK, "2020-01-01", "A_1_10", _LABELS)
    covered_ret = sum(x["weight"] * _RET[x["ticker"]] for x in _BOOK)  # covered == full book here
    total_contrib = sum(res[q]["contrib"] for q in (*QUADRANTS, "unlabeled"))
    assert total_contrib == pytest.approx(covered_ret)


def test_bucket_return_is_contrib_over_weight(patched):
    res = window_return_by_regime(_BOOK, "2020-01-01", "A_1_10", _LABELS)
    # Leading bucket: LEAD1+LEAD2, weight 0.50, contrib 0.30*0.05 + 0.20*0.03 = 0.021
    lead = res["Leading"]
    assert lead["weight"] == pytest.approx(0.50)
    assert lead["contrib"] == pytest.approx(0.021)
    assert lead["ret"] == pytest.approx(0.021 / 0.50)


def test_unlabeled_names_bucketed_separately(patched):
    res = window_return_by_regime(_BOOK, "2020-01-01", "A_1_10", _LABELS)
    assert res["unlabeled"]["weight"] == pytest.approx(0.10)
    assert res["unlabeled"]["ret"] == pytest.approx(0.04)


def test_missing_returns_renormalise(patched, monkeypatch):
    # drop LAG1's return -> covered book excludes it; weights still partition to 1.0
    monkeypatch.setattr(build_lagged, "window_return",
                        lambda tk, s, e: None if tk == "LAG1" else _RET.get(tk))
    res = window_return_by_regime(_BOOK, "2020-01-01", "A_1_10", _LABELS)
    total_w = sum(res[q]["weight"] for q in (*QUADRANTS, "unlabeled"))
    assert total_w == pytest.approx(1.0)
    assert res["Lagging"]["weight"] == pytest.approx(0.0)  # LAG1 dropped for lack of data
