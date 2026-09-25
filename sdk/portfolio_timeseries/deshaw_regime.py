"""D. E. Shaw report-date window return, split by RRG regime quadrant (Tasks 3–5).

Uses Aman's ported classifier (rrg_classifier.py) with POINT-IN-TIME labels (verified causal) to
tag each holding by the quadrant its SECTOR (primary) and SUBSECTOR (thin coverage) sat in AS OF
the report date, then splits the +1..+10 (pre-disclosure) and +45..+55 (post-public) window
returns by quadrant. Answers: does the post-report drift come from names whose factor was already
Leading (momentum) or Lagging/Improving and recovering (mean reversion)?

Coverage is reported on every result. Only 8 subsectors are in Aman's universe, so subsector
coverage is thin — sector-level is the primary result.

CHARACTERISATION, not a strategy (the +1..+10 window is pre-disclosure). All figures gross,
coverage-limited. Reuses build_lagged (cached, bug-fixed gross path) and regime_split.
"""
from __future__ import annotations
import riskmodels  # import-order shim
import sys, json, warnings
from pathlib import Path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import numpy as np
import pandas as pd
import build_lagged as B
import deshaw_report_date as D
import regime_split as RS
import rrg_classifier as R

warnings.filterwarnings("ignore")
B.CACHE_ONLY = True

NAME = "DEShaw"
QUADS = R.QUADRANTS  # ("Leading","Improving","Weakening","Lagging")
WINDOWS = ("A_1_10", "E_45_55")


def _book_weight(holdings):
    return sum((x.get("weight") or 0.0) for x in holdings if x.get("ticker"))


def per_quarter(teos, level="sector"):
    """For each report date: PIT labels -> name labels -> window split by quadrant, for A and E.
    Returns (rows, per-quarter mapping coverage list). level in {'sector','subsector'}."""
    sector_map, sub_map = R.ticker_maps()
    tmap = sector_map if level == "sector" else sub_map
    rows = []
    for t in teos:
        flabels = R.label_fn(t)                      # {FFX_code: quadrant}, point-in-time
        if not flabels:
            continue
        h = B.holdings_for_teo(NAME, t)
        nlabels = RS.name_labels(h["holdings"], flabels, tmap)   # {ticker: quadrant}
        tot = _book_weight(h["holdings"])
        mapped_w = sum((x.get("weight") or 0.0) for x in h["holdings"]
                       if x.get("ticker") in nlabels)
        cov = mapped_w / tot if tot else 0.0
        rec = {"report_date": t, "map_coverage": cov,
               "improving_weight": sum((x.get("weight") or 0.0) for x in h["holdings"]
                                       if nlabels.get(x.get("ticker")) == "Improving") / tot if tot else np.nan}
        for w in WINDOWS:
            split = RS.window_return_by_regime(h["holdings"], t, w, nlabels)
            for q in QUADS:
                if split is None:
                    rec[f"{w}_{q}_contrib"] = np.nan
                    rec[f"{w}_{q}_weight"] = np.nan
                    rec[f"{w}_{q}_ret"] = np.nan
                else:
                    rec[f"{w}_{q}_contrib"] = split[q]["contrib"]
                    rec[f"{w}_{q}_weight"] = split[q]["weight"]
                    rec[f"{w}_{q}_ret"] = split[q]["ret"] if split[q]["weight"] > 0 else np.nan
        rows.append(rec)
    return rows


def _agg(x):
    x = np.asarray([v for v in x if v is not None and not (isinstance(v, float) and np.isnan(v))])
    if len(x) < 2:
        return dict(n=len(x), mean=np.nan)
    return dict(n=len(x), mean=float(x.mean()), std=float(x.std(ddof=1)))


def summarize(rows, wkey):
    """Per-quadrant means (contribution bps, weight, per-unit-weight return bps) for one window."""
    out = {}
    for q in QUADS:
        contrib = _agg([r[f"{wkey}_{q}_contrib"] for r in rows])
        weight = _agg([r[f"{wkey}_{q}_weight"] for r in rows])
        ret = _agg([r[f"{wkey}_{q}_ret"] for r in rows])
        out[q] = {"mean_contrib_bps": contrib["mean"] * 1e4 if not np.isnan(contrib["mean"]) else np.nan,
                  "mean_weight": weight["mean"],
                  "mean_ret_bps": ret["mean"] * 1e4 if not np.isnan(ret["mean"]) else np.nan,
                  "n": ret["n"]}
    return out


def paired_largest_smallest(rows, wkey):
    """Paired t-test of per-unit-weight return between the largest-weight and smallest-weight
    quadrants, across quarters. 4 quadrants → note the multiple-comparison inflation."""
    means_w = {q: np.nanmean([r[f"{wkey}_{q}_weight"] for r in rows]) for q in QUADS}
    big = max(means_w, key=means_w.get)
    small = min(means_w, key=means_w.get)
    diffs = []
    for r in rows:
        a, b = r[f"{wkey}_{big}_ret"], r[f"{wkey}_{small}_ret"]
        if a is not None and b is not None and not np.isnan(a) and not np.isnan(b):
            diffs.append(a - b)
    d = np.asarray(diffs)
    if len(d) < 2:
        return {"largest": big, "smallest": small, "n": len(d)}
    t = d.mean() / (d.std(ddof=1) / np.sqrt(len(d))) if d.std(ddof=1) > 0 else np.nan
    return {"largest": big, "smallest": small, "n": len(d),
            "mean_diff_bps": float(d.mean() * 1e4), "t": float(t),
            "note": "4 quadrants → up to 6 pairwise comparisons; this is the largest-vs-smallest-weight pair, uncorrected"}


def run():
    teos = D.valid_teos()
    print(f"=== D.E.Shaw report-date window split by RRG regime — {len(teos)} report dates ===")
    print(f"    classifier: Aman's RRG (Rothe 2023), point-in-time labels (verified causal)")

    result = {"n_report_dates": len(teos), "levels": {}}
    for level in ("sector", "subsector"):
        rows = per_quarter(teos, level=level)
        covs = [r["map_coverage"] for r in rows]
        print(f"\n--- {level.upper()}-level ---")
        print(f"  mapping coverage (book weight tagged to a {level} quadrant): "
              f"median={np.median(covs):.1%} min={np.min(covs):.1%} max={np.max(covs):.1%} (n={len(rows)})")
        lvl = {"map_coverage": {"median": float(np.median(covs)), "min": float(np.min(covs)),
                                "max": float(np.max(covs))}, "n": len(rows), "windows": {}}
        for w in WINDOWS:
            s = summarize(rows, w)
            pt = paired_largest_smallest(rows, w)
            lvl["windows"][w] = {"quadrants": s, "paired": pt}
            print(f"  [{w}] per-quadrant  contribution(bps) | weight | per-unit-weight return(bps):")
            for q in QUADS:
                print(f"      {q:10} contrib={s[q]['mean_contrib_bps']:7.1f} | w={s[q]['mean_weight']:.1%} "
                      f"| ret={s[q]['mean_ret_bps']:7.1f} (n={s[q]['n']})")
            if "t" in pt:
                print(f"      paired {pt['largest']}(big-w) − {pt['smallest']}(small-w) return: "
                      f"Δ={pt['mean_diff_bps']:.1f}bps t={pt['t']:.2f} (n={pt['n']})")
        # Task 5: Improving concentration
        imp = _agg([r["improving_weight"] for r in rows])
        lvl["mean_improving_weight"] = imp["mean"]
        print(f"  mean book weight in Improving-{level} names at report date: {imp['mean']:.1%}")
        result["levels"][level] = lvl
        # write per-quarter CSV for this level
        pd.DataFrame(rows).to_csv(_HERE / f"deshaw_regime_{level}.csv", index=False, float_format="%.6f")

    result["aman_prior"] = {"note": "entry into Improving on SECTORS, 24w horizon",
                            "prob_gain_pct": 76.6, "ann_pct": 13.81}
    json.dump(result, open(B._CACHE / "deshaw_regime_results.json", "w"), indent=1, default=str)
    print("\nwrote cache/deshaw_regime_results.json, deshaw_regime_{sector,subsector}.csv")
    return result


if __name__ == "__main__":
    run()
