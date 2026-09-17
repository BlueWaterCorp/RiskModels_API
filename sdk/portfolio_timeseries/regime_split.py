"""Regime-classification integration point — wired to Aman's RRG classifier (rrg_classifier.py).

Aman's classifier (ported in rrg_classifier.py, Rothe 2023 RRG construction) labels sector and
subsector *FACTORS* — not names — into four quadrants: Leading / Improving / Weakening / Lagging.
Our holdings are per name, so this module (a) bridges factor labels to per-name labels via the
FFX constituents map, then (b) splits the report-date window return into the four regime buckets.

The question it answers: does the post-report return come from names whose factor was already
LEADING (a momentum signature) or from names whose factor was LAGGING / IMPROVING and then
recovered (a mean-reversion signature).

Interfaces:
  rrg_classifier.label_fn(as_of) -> {FFX_factor_code: quadrant}   (point-in-time, verified causal)
  name_labels(holdings, factor_labels, ticker_factor_map) -> {ticker: quadrant}   (the bridge)
  window_return_by_regime(holdings, teo, window_key, labels) -> per-bucket split
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import build_lagged as B
from deshaw_report_date import win_bounds, WINDOWS, NAME

# Aman's canonical quadrant names (rrg_classifier.QUADRANTS) — do not lowercase; his labels use these.
QUADRANTS = ("Leading", "Improving", "Weakening", "Lagging")


def name_labels(holdings, factor_labels, ticker_factor_map):
    """Bridge factor-level quadrant labels to per-name labels.

    factor_labels     : {FFX_factor_code: quadrant}  (from rrg_classifier.label_fn(teo))
    ticker_factor_map : {ticker: FFX_factor_code}     (sector OR subsector map from rrg.ticker_maps)
    Returns {ticker: quadrant} for every held name whose factor is both mapped and labelled.
    """
    out = {}
    for x in holdings:
        tk = x.get("ticker")
        if not tk:
            continue
        fac = ticker_factor_map.get(tk)
        if fac is None:
            continue
        q = factor_labels.get(fac)
        if q is not None:
            out[tk] = q
    return out


def window_return_by_regime(holdings, teo, window_key, labels):
    """Split one report date's window return into regime buckets.

    holdings   : list of {ticker, weight, ...} (the disclosed book for `teo`)
    teo        : report date 'YYYY-MM-DD'
    window_key : key into WINDOWS, e.g. 'A_1_10'
    labels     : dict ticker -> quadrant (one of QUADRANTS); names absent -> 'unlabeled'

    Returns dict bucket -> {weight, contrib, ret} where
      weight  = book weight in that bucket (renormalised to the covered book),
      contrib = that bucket's contribution to the portfolio window return (Σ w_i R_i / covered),
      ret     = bucket's own window return (contrib / weight).
    Buckets' `contrib` sum to the covered-book window return; `weight` sum to 1.0.
    """
    ds, de = WINDOWS[window_key]
    b = win_bounds(teo, ds, de)
    if b is None:
        return None
    start, end = b
    buckets = {q: {"weight": 0.0, "contrib": 0.0} for q in (*QUADRANTS, "unlabeled")}
    covered = 0.0
    for x in holdings:
        tk, w = x.get("ticker"), (x.get("weight") or 0.0)
        if not tk:
            continue
        R = B.window_return(tk, start, end)
        if R is None:
            continue
        q = labels.get(tk, "unlabeled")
        if q not in buckets:
            q = "unlabeled"
        buckets[q]["weight"] += w
        buckets[q]["contrib"] += w * R
        covered += w
    if covered <= 0:
        return None
    for q in buckets:
        buckets[q]["weight"] /= covered
        buckets[q]["contrib"] /= covered
        buckets[q]["ret"] = (buckets[q]["contrib"] / buckets[q]["weight"]
                             if buckets[q]["weight"] > 0 else float("nan"))
    return buckets


def aggregate_by_regime(teos, label_fn, window_key="A_1_10", name=NAME):
    """Mean bucket contribution / return across studiable report dates.

    label_fn(teo) -> {ticker: quadrant}. Wire Aman's classifier here; until it lands, pass a
    synthetic labeler (see test_regime_split.py) to exercise the path end to end.
    """
    contribs = {q: [] for q in (*QUADRANTS, "unlabeled")}
    rets = {q: [] for q in (*QUADRANTS, "unlabeled")}
    weights = {q: [] for q in (*QUADRANTS, "unlabeled")}
    used = 0
    for t in teos:
        h = B.holdings_for_teo(name, t)
        labels = label_fn(t)
        res = window_return_by_regime(h["holdings"], t, window_key, labels)
        if res is None:
            continue
        used += 1
        for q in contribs:
            contribs[q].append(res[q]["contrib"])
            weights[q].append(res[q]["weight"])
            if res[q]["weight"] > 0:
                rets[q].append(res[q]["ret"])
    out = {}
    for q in contribs:
        c = np.asarray(contribs[q])
        out[q] = {
            "mean_contrib_bps": float(c.mean() * 1e4) if len(c) else float("nan"),
            "mean_weight": float(np.mean(weights[q])) if weights[q] else float("nan"),
            "mean_ret_bps": float(np.mean(rets[q]) * 1e4) if rets[q] else float("nan"),
            "n": len(c),
        }
    out["_n_report_dates"] = used
    return out
