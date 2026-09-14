"""2A -- size-and-sector-matched placebo control for the D. E. Shaw post-report effect.

The open question from DESHAW_REPORT_DATE §7.2: the covered D. E. Shaw names skew
large and index-eligible, so the +135 bps rise over days +1..+10 might be a
large-cap post-quarter-end effect rather than anything about D. E. Shaw. The SPY
regression (alpha t=-0.64) already says the window carries no alpha over the
market, but SPY is a cap-weighted index, not a book that looks like theirs.

This builds the sharper control: for each report date, replace every held name with
a DIFFERENT name from the same sector and a similar within-sector market-cap weight,
keep D. E. Shaw's portfolio weights, and run the identical +1..+10 measurement.
Repeat many times to get a null distribution.

    If D. E. Shaw's actual window return sits in the middle of that null, the rise
    is a property of the universe -- large, index-eligible names in those particular
    windows -- and not of D. E. Shaw's selection.

Matching data. `ffx_constituents_latest.csv` gives, per FFX sector factor, each
member's weight WITHIN that factor. Those are cap weights (XOM is 23% of FFX_XLE),
so a name's within-sector weight is a clean relative-size measure. Names are matched
inside the same sector on log within-sector weight, nearest available neighbour,
sampled without replacement.

LIMITATION, stated because it matters: the constituents file is a single snapshot
dated 2026-07-02, so sector membership and relative size are applied historically.
Size ranks are persistent but not point-in-time. This is acceptable here because the
matching only defines a CONTROL GROUP -- it is not a signal and cannot leak into
D. E. Shaw's own measured return -- but a name that grew or shrank a lot over 13
years is matched on its end-of-sample size. Read the null as approximate.

Hermetic apart from the cached return series. Zero API spend.
Run:  python deshaw_size_control.py [n_draws]
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
import deshaw_report_date as D

B.CACHE_ONLY = True

N_DRAWS = 500
SEED = 20260907
WINDOW = "A_1_10"
CONTROL_WINDOW = "E_45_55"


def sector_universe():
    """{ticker: (sector_factor, log within-sector cap weight)} for FFX sector factors only.

    Aman's sector factors are the 11 ETF-coded ones (FFX_XL*, FFX_IY*, ...); the
    numeric codes (FFX_1105 etc.) are subsectors. We match on SECTOR because that is
    the level with usable coverage (91% of book weight, vs 10% for subsector).
    """
    df = pd.read_csv(_HERE / "ffx_constituents_latest.csv")
    df = df[~df["factor"].str.match(r"FFX_\d+$")]  # keep ETF-coded sector factors
    df = df[df["weight"] > 0]
    out = {}
    for tk, g in df.groupby("ticker"):
        r = g.nlargest(1, "weight").iloc[0]      # a name's primary sector
        out[tk] = (r["factor"], float(np.log(r["weight"])))
    return out


def precompute_window_returns(teos, tickers, window):
    """{teo: {ticker: R}} for one window. Computed once; the draws are then lookups."""
    ds, de = D.WINDOWS[window]
    table = {}
    for t in teos:
        b = D.win_bounds(t, ds, de)
        if b is None:
            continue
        start, end = b
        row = {}
        for tk in tickers:
            R = B.window_return(tk, start, end)
            if R is not None and not np.isnan(R):
                row[tk] = R
        table[t] = row
    return table


CALIPER = 10  # each held name is replaced from its 10 nearest same-sector size neighbours


def neighbour_table(held, universe, ret_row):
    """For each held name, its CALIPER nearest same-sector neighbours by log cap weight.

    Built ONCE per (report date, window); the draws then just index into it. Neighbours
    are drawn with replacement across names within a draw -- with 10 candidates per name
    and hundreds of names, collisions are rare and do not bias the null, and it avoids an
    O(draws x names x candidates) resort.
    """
    by_sector = {}
    for tk, (sec, lw) in universe.items():
        if tk in ret_row:
            by_sector.setdefault(sec, []).append((tk, lw))
    for sec in by_sector:
        by_sector[sec].sort(key=lambda z: z[1])

    out = {}
    heldset = set(held)
    for tk in held:
        info = universe.get(tk)
        if info is None:
            continue
        sec, lw = info
        pool = by_sector.get(sec, [])
        if len(pool) < 2:
            continue
        lws = np.array([z[1] for z in pool])
        order = np.argsort(np.abs(lws - lw))
        picks = []
        for idx in order:
            c = pool[idx][0]
            if c != tk and c not in heldset:
                picks.append(c)
            if len(picks) >= CALIPER:
                break
        if picks:
            vals = np.array([ret_row[c] for c in picks], float)
            if len(vals) < CALIPER:      # pad so every row is CALIPER wide (ragged -> rectangular)
                vals = np.resize(vals, CALIPER)
            out[tk] = vals
    return out


def run(n_draws=N_DRAWS):
    rng = np.random.default_rng(SEED)
    teos = D.valid_teos()
    universe = sector_universe()

    # every ticker we might need a return for: held names + the whole matching pool
    books = {t: B.holdings_for_teo(D.NAME, t)["holdings"] for t in teos}
    held_all = {x["ticker"] for h in books.values() for x in h if x.get("ticker")}
    need = sorted(held_all | set(universe))
    print(f"precomputing window returns for {len(need)} tickers x {len(teos)} report dates ...")

    results = {}
    for wkey in (WINDOW, CONTROL_WINDOW):
        table = precompute_window_returns(teos, need, wkey)

        # --- actual D. E. Shaw book, restricted to names that HAVE a size match,
        #     so actual and placebo are measured on exactly the same footing ---
        actual, placebo_draws, cov_list = [], [[] for _ in range(n_draws)], []
        matchable_teos = []
        for t in teos:
            ret_row = table.get(t, {})
            held = {x["ticker"]: (x.get("weight") or 0.0) for x in books[t]
                    if x.get("ticker") and x["ticker"] in ret_row and x["ticker"] in universe}
            if not held:
                continue
            tot = sum(held.values())
            if tot <= 0:
                continue
            nb = neighbour_table(list(held), universe, ret_row)
            matched = [tk for tk in held if tk in nb]
            if not matched:
                continue
            matchable_teos.append(t)
            # measure the ACTUAL book on exactly the names that have a match, so
            # actual and placebo are like-for-like
            wts = np.array([held[tk] for tk in matched], float)
            wts = wts / wts.sum()
            actual.append(float(wts @ np.array([ret_row[tk] for tk in matched])))
            full = sum((x.get("weight") or 0.0) for x in books[t] if x.get("ticker"))
            cov_list.append(sum(held[tk] for tk in matched) / full if full else np.nan)

            # (n_names x CALIPER) matrix of candidate returns -> vectorised draws
            cand = np.vstack([nb[tk] for tk in matched])          # (n_names, CALIPER)
            idx = rng.integers(0, cand.shape[1], size=(n_draws, cand.shape[0]))
            cols = np.arange(cand.shape[0])[None, :]               # (1, n_names)
            picked = cand[cols, idx]                               # (n_draws, n_names)
            vals = picked @ wts
            for d in range(n_draws):
                placebo_draws[d].append(float(vals[d]))

        actual = np.array(actual)
        draws = np.array([np.nanmean(p) for p in placebo_draws])
        a_mean = actual.mean()
        pctile = float((draws < a_mean).mean() * 100)

        # PAIRED test -- the statistic that actually answers the question.
        #
        # The spread of `draws` is Monte-Carlo/matching variation in the placebo
        # MEAN only; it says nothing about how noisy the 49-quarter average is.
        # Comparing the actual mean to that spread makes tiny differences look
        # significant. The right test pairs by quarter: for each report date take
        # (actual - mean placebo for that date) and t-test the 49 differences,
        # which carries the quarter-level variance the question depends on.
        per_q_placebo = np.nanmean(np.array(placebo_draws), axis=0)   # (n_report_dates,)
        d = actual - per_q_placebo
        t_paired = float(d.mean() / (d.std(ddof=1) / np.sqrt(len(d)))) if d.std(ddof=1) > 0 else np.nan
        results[wkey] = {
            "n_report_dates": len(matchable_teos),
            "n_draws": n_draws,
            "matched_coverage_median": float(np.nanmedian(cov_list)),
            "actual_mean_bps": float(a_mean * 1e4),
            "actual_t": float(a_mean / (actual.std(ddof=1) / np.sqrt(len(actual)))),
            "placebo_mean_bps": float(draws.mean() * 1e4),
            "placebo_sd_bps": float(draws.std(ddof=1) * 1e4),
            "placebo_p05_bps": float(np.percentile(draws, 5) * 1e4),
            "placebo_p95_bps": float(np.percentile(draws, 95) * 1e4),
            "actual_percentile_in_null": pctile,
            "diff_bps": float((a_mean - draws.mean()) * 1e4),
            "z_vs_montecarlo_spread": float((a_mean - draws.mean()) / draws.std(ddof=1)),
            "paired_diff_mean_bps": float(d.mean() * 1e4),
            "paired_diff_t": t_paired,
            "actual_se_bps": float(actual.std(ddof=1) / np.sqrt(len(actual)) * 1e4),
        }

    print("\n" + "=" * 84)
    print("2A -- SIZE-AND-SECTOR-MATCHED PLACEBO CONTROL (D. E. Shaw)")
    print(f"     {n_draws} random matched books per report date, seed {SEED}")
    print("=" * 84)
    for wkey, r in results.items():
        print(f"\n--- window {wkey} --- n={r['n_report_dates']} report dates, "
              f"matched-name coverage median {r['matched_coverage_median']:.1%}")
        print(f"    D. E. Shaw actual        {r['actual_mean_bps']:>+8.0f} bps  (t={r['actual_t']:+.2f})")
        print(f"    matched placebo mean     {r['placebo_mean_bps']:>+8.0f} bps  "
              f"(sd {r['placebo_sd_bps']:.0f}, 5-95% "
              f"{r['placebo_p05_bps']:+.0f} .. {r['placebo_p95_bps']:+.0f})")
        print(f"    difference               {r['diff_bps']:>+8.0f} bps")
        print(f"    D. E. Shaw sits at the {r['actual_percentile_in_null']:.0f}th percentile "
              f"of the matched-book null (Monte-Carlo spread only)")
        print(f"    PAIRED by quarter        {r['paired_diff_mean_bps']:>+8.0f} bps  "
              f"t={r['paired_diff_t']:+.2f}  (n={r['n_report_dates']})   <- the test that counts")
        print(f"    for scale: the actual 49-quarter mean has SE {r['actual_se_bps']:.0f} bps, "
              f"vs {r['placebo_sd_bps']:.0f} bps of Monte-Carlo spread")
        sig = abs(r["paired_diff_t"]) >= 2.0
        verdict = ("SELECTION: the paired difference clears |t|>=2"
                   if sig else
                   "NO SELECTION: the paired difference is not distinguishable from zero. "
                   "The window return\n       is a property of the size/sector universe, "
                   "not of D. E. Shaw's picks.")
        print(f"    -> {verdict}")

    (_HERE / "cache" / "deshaw_size_control.json").write_text(
        json.dumps(results, indent=1, default=str))
    print("\nwrote cache/deshaw_size_control.json")
    return results


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else N_DRAWS)
