"""2B -- transaction-cost haircut on the Berkshire sector+subsector sleeve.

The sleeve is quoted gross at ~2.2%/yr (ATTRIBUTION_PLAN §2) / ~2.1-2.6%/yr on the
rebuild (LAGGED_RESULTS §6). On a quarterly-rebalanced ETF expression, costs are a
material fraction of a number that small, and a gross figure that leaves this room
gets quoted externally as if it were net. This puts a defensible bound on it.

WHAT IS BEING COSTED. The sector+subsector layer return is an ATTRIBUTION, not a
portfolio -- it is what the factor layers contributed inside the book. To trade it
you would hold the sector and subsector ETF exposures the book implies and rebalance
them when the book's loadings change. So the cost driver is not the filer's stock
turnover; it is the turnover of the ETF OVERLAY implied by the book, rebalanced once
a quarter.

TURNOVER IS MEASURED, NOT ASSUMED. Per quarter we compute the one-way turnover of
the disclosed book's weights,
    turnover_t = 0.5 * sum_i |w_i,t - w_i,t-1|
and, separately, the turnover of the book's sector-ETF weight vector (positions
mapped to their sector via the FFX constituents map), which is what an ETF overlay
would actually trade. Both are reported; the ETF-level figure is the one used,
because a name swap inside the same sector costs the overlay nothing.

COST ASSUMPTIONS -- stated so they can be argued with:
  * Sector/subsector ETFs (XLK, XLF, RSPT ...) are among the most liquid instruments
    listed. Round-trip all-in cost is taken at 5 bps as the base case: roughly
    1 bp commission + ~1-2 bps half-spread each way + a small impact allowance at
    institutional size. 2 bps is the optimistic floor for the largest sector ETFs,
    15 bps a pessimistic case covering thinner subsector products (RSPT and similar)
    and larger size.
  * No financing, no borrow, no short rebate. The sleeve as attributed is long the
    factor exposures; a market-neutral expression would add financing on the short
    leg, which this does NOT include and which would make the net figure worse.
  * No taxes, no capacity constraint.

These are order-of-magnitude assumptions from public market structure, NOT measured
execution data -- we have no fills. The output is a haircut range, not a P&L.

Run:  python cost_estimate.py
"""
from __future__ import annotations
import sys, json, warnings
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import build_lagged as B

B.CACHE_ONLY = True

NAME = "Berkshire"
COST_CASES_BPS = {"optimistic": 2.0, "base": 5.0, "pessimistic": 15.0}


def sector_map():
    """{ticker: FFX sector factor} from the constituents file (ETF-coded factors only)."""
    df = pd.read_csv(_HERE / "ffx_constituents_latest.csv")
    df = df[~df["factor"].str.match(r"FFX_\d+$")]
    out = {}
    for tk, g in df.groupby("ticker"):
        out[tk] = g.nlargest(1, "weight").iloc[0]["factor"]
    return out


def weight_vectors():
    """Per buildable teo: the book's name-weight vector and its sector-ETF weight vector."""
    rows = B.portfolio_rows(NAME)
    smap = sector_map()
    out = []
    for r in rows:
        h = B.holdings_for_teo(NAME, r["teo"])
        if h.get("report_date") != r["teo"]:
            continue
        names, sectors = {}, {}
        for x in h["holdings"]:
            tk, w = x.get("ticker"), (x.get("weight") or 0.0)
            if not tk or w <= 0:
                continue
            names[tk] = names.get(tk, 0.0) + w
            sec = smap.get(tk)
            if sec:
                sectors[sec] = sectors.get(sec, 0.0) + w
        tot = sum(names.values())
        if tot <= 0:
            continue
        out.append({
            "teo": r["teo"],
            "names": {k: v / tot for k, v in names.items()},
            "sectors": {k: v / tot for k, v in sectors.items()},
            "sector_mapped_w": sum(sectors.values()) / tot,
        })
    return out


def one_way_turnover(prev, cur):
    keys = set(prev) | set(cur)
    return 0.5 * sum(abs(cur.get(k, 0.0) - prev.get(k, 0.0)) for k in keys)


def main():
    vecs = weight_vectors()
    name_to, sec_to = [], []
    for a, b in zip(vecs, vecs[1:]):
        name_to.append(one_way_turnover(a["names"], b["names"]))
        sec_to.append(one_way_turnover(a["sectors"], b["sectors"]))
    name_to, sec_to = np.array(name_to), np.array(sec_to)

    # gross sleeve figures from the current re-audit (single source of truth)
    ra = json.loads((_HERE / "cache" / "reaudit_berkshire.json").read_text())
    lag = ra["stage2"]["lagged"]["sector_plus_subsector"]
    unl = ra["stage2"]["unlagged"]["sector_plus_subsector"]

    print("=" * 80)
    print("2B -- TRANSACTION-COST HAIRCUT, Berkshire sector+subsector sleeve")
    print("=" * 80)
    print(f"\nMeasured quarterly one-way turnover ({len(sec_to)} quarter-pairs):")
    print(f"    book, name level      mean {name_to.mean():6.2%}  median {np.median(name_to):6.2%}  "
          f"max {name_to.max():6.2%}")
    print(f"    implied sector-ETF    mean {sec_to.mean():6.2%}  median {np.median(sec_to):6.2%}  "
          f"max {sec_to.max():6.2%}")
    print(f"    sector-map coverage   median {np.median([v['sector_mapped_w'] for v in vecs]):.1%} of book weight")
    print("\n    The ETF-level figure is lower than the name-level one because a swap")
    print("    between two names in the same sector does not move the overlay.")

    ann_turnover = sec_to.mean() * 4          # one-way, per year
    print(f"\nAnnual one-way sector-ETF turnover: {ann_turnover:.1%}")

    out = {"n_quarter_pairs": int(len(sec_to)),
           "name_turnover_mean": float(name_to.mean()),
           "sector_etf_turnover_mean": float(sec_to.mean()),
           "annual_one_way_turnover": float(ann_turnover),
           "gross_lagged_ann_pct": lag["ann_pct"], "gross_unlagged_ann_pct": unl["ann_pct"],
           "cases": {}}

    print(f"\n{'case':<13} {'rt cost':>8} {'ann drag':>9} | {'LAGGED sleeve':>24} | {'UNLAGGED sleeve':>24}")
    print(f"{'':<13} {'(bps)':>8} {'(bps/yr)':>9} | {'gross':>8} {'net':>8} {'kept':>6} | "
          f"{'gross':>8} {'net':>8} {'kept':>6}")
    for case, rt in COST_CASES_BPS.items():
        drag_bps = ann_turnover * rt          # one-way turnover x round-trip cost
        row = {"round_trip_bps": rt, "annual_drag_bps": float(drag_bps)}
        cells = []
        for lbl, s in (("lag", lag), ("unl", unl)):
            gross_bps = s["ann_pct"] * 100
            net_bps = gross_bps - drag_bps
            row[f"{lbl}_gross_bps"] = float(gross_bps)
            row[f"{lbl}_net_bps"] = float(net_bps)
            row[f"{lbl}_pct_kept"] = float(net_bps / gross_bps * 100)
            cells.append((gross_bps, net_bps, net_bps / gross_bps * 100))
        out["cases"][case] = row
        print(f"{case:<13} {rt:>8.0f} {drag_bps:>9.0f} | "
              f"{cells[0][0]:>7.0f}b {cells[0][1]:>7.0f}b {cells[0][2]:>5.0f}% | "
              f"{cells[1][0]:>7.0f}b {cells[1][1]:>7.0f}b {cells[1][2]:>5.0f}%")

    base = out["cases"]["base"]
    print(f"\nRead: at the base case the sleeve keeps {base['lag_pct_kept']:.0f}% of its gross "
          f"lagged return\n      ({base['lag_gross_bps']:.0f} -> {base['lag_net_bps']:.0f} bps/yr). "
          f"Costs are NOT what kills this sleeve -- the\n      book turns over slowly at sector level, "
          f"so the drag is {base['annual_drag_bps']:.0f} bps/yr against a\n      "
          f"{base['lag_gross_bps']:.0f} bps/yr gross figure. What kills it is that the gross figure "
          f"itself is\n      not statistically distinguishable from zero "
          f"(t={lag['t']:.2f}, n={lag['n']}).")
    print("\nNOT included: financing/borrow on any short leg, taxes, capacity, slippage")
    print("beyond the stated round-trip assumption. A market-neutral expression would")
    print("add financing and be materially worse than the figures above.")

    (_HERE / "cache" / "cost_estimate.json").write_text(json.dumps(out, indent=1, default=str))
    print("\nwrote cache/cost_estimate.json")
    return out


if __name__ == "__main__":
    main()
