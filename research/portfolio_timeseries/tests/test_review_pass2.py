"""Hermetic tests for PR #373 review findings 4-8 (the second pass).

  4. The gates are CONTROLS: `enforce_gate` refuses on STOP, `layer_gate_verdict` is the
     one layer bar, `stage0_summary` is the one Stage 0 summary.
  5. The terminal row is detected by PROPERTY (max teo of the RAW endpoint series), so a
     trailing null-gross row no longer makes a kept row look terminal.
  6. The 1,000-row holdings cap is quantified (`book_truncation`), so coverage can state
     its basis.
  7. Layer figures carry their coverage (`covered_w`, `n_names`).
  8. A NaN TAIL (delisting without a terminal print) truncates the loss — documented
     behaviour, pinned so it cannot change silently.

No network, no cache: module caches are seeded directly, exactly as in
test_window_primitives.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_lagged as B  # noqa: E402

DAYS = pd.date_range("2020-01-01", periods=20, freq="D")


@pytest.fixture(autouse=True)
def clean_caches():
    saved_r, saved_d, saved_td = dict(B._ret_cache), dict(B._decomp_cache), B._tdays
    B._ret_cache.clear(); B._decomp_cache.clear(); B._tdays = None
    yield
    B._ret_cache.clear(); B._ret_cache.update(saved_r)
    B._decomp_cache.clear(); B._decomp_cache.update(saved_d)
    B._tdays = saved_td


def put_returns(ticker, values, index=DAYS):
    B._ret_cache[ticker] = pd.Series(np.asarray(values, dtype=float), index=index)


def put_decomp(ticker, layers, index=DAYS):
    B._decomp_cache[ticker] = {k: pd.Series(np.asarray(v, dtype=float), index=index)
                               for k, v in layers.items()}


# ----------------------------------------------------------------- 8. NaN tail
def test_nan_tail_truncates_the_loss_documented_behaviour():
    """A name that prints +1%/day for 10 days then goes NaN (delisted, no terminal print)
    compounds over its printed days only. The post-delisting loss is NOT seen, and the name
    still counts as covered. This is a known limitation, not a bug being fixed here — the
    test exists so the behaviour cannot change without someone noticing."""
    vals = [0.01] * 10 + [np.nan] * 10
    put_returns("DELISTED", vals)
    r = B.window_return("DELISTED", DAYS[0], DAYS[19])
    assert r is not None, "a NaN tail must not make the name vanish from coverage"
    assert r == pytest.approx(1.01 ** 9 - 1), "only the printed days are compounded (window is start-exclusive)"
    # and the portfolio treats it as covered at its full weight
    holdings = [{"ticker": "DELISTED", "weight": 1.0}]
    renorm, _, covered, n, missing = B.portfolio_window_return(holdings, DAYS[0], DAYS[19])
    assert covered == pytest.approx(1.0) and n == 1 and missing == []
    assert renorm == pytest.approx(1.01 ** 9 - 1)


def test_interior_nan_equals_a_zero_return_day():
    """The flip side of finding 8: an interior NaN is a zero-return day, which is right
    when the next print spans the gap."""
    vals = [0.01] * 20
    vals[5] = np.nan
    put_returns("GAP", vals)
    assert B.window_return("GAP", DAYS[0], DAYS[10]) == pytest.approx(1.01 ** 9 - 1)


# ----------------------------------------------------------------- 7. layer coverage
def test_portfolio_window_layers_reports_its_coverage():
    put_decomp("AAA", {"market": [0.001] * 20, "sector": [0.0] * 20,
                       "subsector": [0.0] * 20, "idiosyncratic": [0.0] * 20})
    B._decomp_cache["GONE"] = None
    holdings = [{"ticker": "AAA", "weight": 0.4}, {"ticker": "GONE", "weight": 0.6}]
    lay = B.portfolio_window_layers(holdings, DAYS[0], DAYS[10])
    assert lay["covered_w"] == pytest.approx(0.4)
    assert lay["n_names"] == 1
    assert lay["market"] == pytest.approx(1.001 ** 10 - 1)   # imputed to the uncovered 60%


def test_portfolio_window_layers_with_nothing_covered_is_nan_with_zero_coverage():
    B._decomp_cache["GONE"] = None
    lay = B.portfolio_window_layers([{"ticker": "GONE", "weight": 1.0}], DAYS[0], DAYS[10])
    assert np.isnan(lay["market"]) and lay["covered_w"] == 0.0 and lay["n_names"] == 0


# ----------------------------------------------------------------- 6. truncation
def test_book_truncation_reports_the_unlisted_tail():
    rec = {"n_total_holdings": 2400, "n_holdings_returned": 1000,
           "holdings": [{"ticker": "A", "weight": 0.6}, {"ticker": "B", "weight": 0.37}]}
    t = B.book_truncation(rec)
    assert t["truncated"] is True
    assert t["returned_w_sum"] == pytest.approx(0.97)
    assert t["tail_w"] == pytest.approx(0.03)


def test_book_truncation_is_zero_for_a_complete_book():
    rec = {"n_total_holdings": 25, "n_holdings_returned": 25,
           "holdings": [{"ticker": "A", "weight": 0.5}, {"ticker": "B", "weight": 0.5}]}
    t = B.book_truncation(rec)
    assert t["truncated"] is False and t["tail_w"] == pytest.approx(0.0)


# ----------------------------------------------------------------- 5. terminal by property
def test_terminal_row_is_the_raw_max_teo_not_the_last_kept_row(monkeypatch):
    """Conrad's scenario: the endpoint's last row has a NULL gross. The old `[-1]` on the
    filtered list would call 2025-09-30 terminal and drop a good quarter; the real terminal
    row is 2025-12-31."""
    raw = [{"teo": "2025-06-30", "portfolio_gross_return": 0.03},
           {"teo": "2025-09-30", "portfolio_gross_return": 0.02},
           {"teo": "2025-12-31", "portfolio_gross_return": None}]
    monkeypatch.setattr(B, "_read", lambda p: raw)
    assert B.portfolio_rows("Berkshire")[-1]["teo"] == "2025-09-30"   # the fragile pick
    assert B.terminal_teo("Berkshire") == "2025-12-31"                 # the property
    assert B.is_terminal("Berkshire", "2025-12-31")
    assert not B.is_terminal("Berkshire", "2025-09-30")


# ----------------------------------------------------------------- 4. gates as controls
def test_layer_gate_is_one_bar_on_the_median_and_names_the_failing_layers():
    v = {"market": {"median_bps": 17.0}, "sector": {"median_bps": 4.0},
         "subsector": {"median_bps": 1.0}, "idiosyncratic": {"median_bps": 29.0}}
    assert B.layer_gate_verdict(v) == ("PASS", {})
    v["idiosyncratic"]["median_bps"] = 59.0                     # the D. E. Shaw case
    verdict, failing = B.layer_gate_verdict(v)
    assert verdict == "FAIL" and failing == {"idiosyncratic": 59.0}
    assert B.LAYER_GATE_MEDIAN_BPS == 50.0


def _recs(diffs, terminal="2025-12-31", with_terminal_diff=None):
    out = [{"teo": f"20{i:02d}-03-31", "book_ok": True, "diff_renorm_bps": d, "covered_w": 1.0}
           for i, d in enumerate(diffs, start=10)]
    if with_terminal_diff is not None:
        out.append({"teo": terminal, "book_ok": True, "diff_renorm_bps": with_terminal_diff,
                    "covered_w": 1.0})
    return out


def test_stage0_summary_excludes_the_terminal_row_and_applies_the_mean_gate(monkeypatch):
    monkeypatch.setattr(B, "terminal_teo", lambda name: "2025-12-31")
    # 40 bps everywhere, plus a 1000 bps terminal row: with it -> STOP, without it -> FLAG
    recs = _recs([40.0] * 10, with_terminal_diff=1000.0)
    g = B.stage0_summary("Berkshire", recs=recs)
    assert g["n"] == 10 and g["terminal_teo"] == "2025-12-31"
    assert g["mean_bps"] == pytest.approx(40.0) and g["verdict"] == "PROCEED_WITH_FLAG"
    g_incl = B.stage0_summary("Berkshire", recs=recs, drop_terminal=False)
    assert g_incl["n"] == 11 and g_incl["verdict"] == "STOP"


def test_enforce_gate_refuses_on_stop_and_only_warns_with_force(monkeypatch):
    monkeypatch.setattr(B, "terminal_teo", lambda name: "2099-12-31")
    monkeypatch.setattr(B, "stage0", lambda name: _recs([80.0] * 8))     # mean 80 > 75
    with pytest.raises(B.GateStop):
        B.enforce_gate("Berkshire")
    g = B.enforce_gate("Berkshire", force=True)                           # loud, not fatal
    assert g["verdict"] == "STOP"


def test_enforce_gate_passes_through_on_flag_and_clean(monkeypatch):
    monkeypatch.setattr(B, "terminal_teo", lambda name: "2099-12-31")
    monkeypatch.setattr(B, "stage0", lambda name: _recs([61.0] * 8))
    assert B.enforce_gate("Berkshire")["verdict"] == "PROCEED_WITH_FLAG"
    monkeypatch.setattr(B, "stage0", lambda name: _recs([10.0] * 8))
    assert B.enforce_gate("Berkshire")["verdict"] == "CLEAN"
